import { miniprogramState, wxPost } from '../lib/wx'
import type { Env } from '../types'

/**
 * 微信订阅消息
 *
 * 和小程序的「站内消息」不是一回事：站内消息是我们自己的表，用户点开小程序才看得到；
 * 订阅消息由微信推一条服务通知，用户不进小程序也能收到。
 *
 * 规则是「一次授权、一条消息」：
 *   1. 用户在小程序里点一个按钮，弹窗同意某个模板 → 服务端多一次发送额度
 *   2. 我们发一条 → 扣一次额度
 *   3. 额度用完就不再发，直到用户再次授权
 *
 * 所以这里没有「永久订阅」的错觉：额度存 wx_subscriptions，
 * 设置页开关只决定「愿不愿意发」，能不能发得看额度。
 *
 * 没配置模板 ID（开发期常态）时所有函数都安静跳过，不抛错、不影响投票评论。
 */

export type PushKind = 'joined' | 'comment' | 'deadline' | 'result'

const PUSH_KINDS: PushKind[] = ['joined', 'comment', 'deadline', 'result']

const TEMPLATE_ENV: Record<PushKind, keyof Env> = {
  joined: 'WX_TMPL_JOINED',
  comment: 'WX_TMPL_COMMENT',
  deadline: 'WX_TMPL_DEADLINE',
  result: 'WX_TMPL_RESULT'
}

/** 同一条通知最多攒 3 次额度，避免用户反复点把表撑大 */
const MAX_QUOTA = 3

/** 默认字段名；在微信后台选模板时对不上，用 WX_TMPL_FIELDS 覆盖 */
const DEFAULT_FIELDS = { title: 'thing1', time: 'time2', remark: 'thing3' }

type Fields = typeof DEFAULT_FIELDS

export interface PushPrefs {
  enabled: boolean
  joined: boolean
  comment: boolean
  deadline: boolean
  result: boolean
}

export const DEFAULT_PREFS: PushPrefs = {
  enabled: true,
  joined: true,
  comment: true,
  deadline: true,
  result: true
}

export function isPushKind(kind: string): kind is PushKind {
  return (PUSH_KINDS as string[]).includes(kind)
}

/** 已配置的模板：kind → template_id；没配的 kind 不出现在结果里 */
export function templates(env: Env): Partial<Record<PushKind, string>> {
  const out: Partial<Record<PushKind, string>> = {}
  for (const kind of PUSH_KINDS) {
    const raw = env[TEMPLATE_ENV[kind]]
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (id) out[kind] = id
  }
  return out
}

function fields(env: Env): Fields {
  if (!env.WX_TMPL_FIELDS) return DEFAULT_FIELDS
  try {
    const parsed = JSON.parse(env.WX_TMPL_FIELDS) as Partial<Fields>
    return { ...DEFAULT_FIELDS, ...parsed }
  } catch {
    return DEFAULT_FIELDS
  }
}

/** thing 类型字段上限 20 字，超了微信会拒收 */
function clip(text: string, max: number): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** 订阅消息的 time 字段要「YYYY-MM-DD HH:mm」，Worker 是 UTC，这里按东八区格式化 */
function timeText(ts: number): string {
  const d = new Date(ts + 8 * 3600_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}`
}

/* ---------------- 偏好 ---------------- */

export async function getPrefs(db: D1Database, userId: string): Promise<PushPrefs> {
  const row = await db
    .prepare('SELECT enabled, joined, comment, deadline, result FROM wx_push_prefs WHERE user_id = ?')
    .bind(userId)
    .first<Record<keyof PushPrefs, number>>()
  if (!row) return { ...DEFAULT_PREFS }
  return {
    enabled: row.enabled !== 0,
    joined: row.joined !== 0,
    comment: row.comment !== 0,
    deadline: row.deadline !== 0,
    result: row.result !== 0
  }
}

/** 只收认识的字段，前端传什么都不能写进别的列 */
export function parsePrefs(raw: unknown): Partial<PushPrefs> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as Record<string, unknown>
  const out: Partial<PushPrefs> = {}
  for (const key of Object.keys(DEFAULT_PREFS) as Array<keyof PushPrefs>) {
    if (typeof src[key] === 'boolean') out[key] = src[key]
  }
  return Object.keys(out).length ? out : undefined
}

export async function savePrefs(
  db: D1Database,
  userId: string,
  patch: Partial<PushPrefs>
): Promise<PushPrefs> {
  const next = { ...(await getPrefs(db, userId)), ...patch }
  await db
    .prepare(
      `INSERT INTO wx_push_prefs (user_id, enabled, joined, comment, deadline, result, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         enabled = excluded.enabled, joined = excluded.joined, comment = excluded.comment,
         deadline = excluded.deadline, result = excluded.result, updated_at = excluded.updated_at`
    )
    .bind(
      userId,
      next.enabled ? 1 : 0,
      next.joined ? 1 : 0,
      next.comment ? 1 : 0,
      next.deadline ? 1 : 0,
      next.result ? 1 : 0,
      Date.now()
    )
    .run()
  return next
}

/* ---------------- 授权额度 ---------------- */

/**
 * 用户在小程序里同意订阅后调用：每个模板 +1 次额度。
 * templateIds 由路由层按「已配置的模板」过滤过，这里不再重复校验。
 */
export async function recordSubscription(
  db: D1Database,
  userId: string,
  templateIds: string[],
  prefs?: Partial<PushPrefs>
): Promise<void> {
  const now = Date.now()
  const statements = templateIds.map((templateId) =>
    db
      .prepare(
        `INSERT INTO wx_subscriptions (user_id, template_id, remaining, updated_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(user_id, template_id) DO UPDATE SET
           remaining = MIN(remaining + 1, ${MAX_QUOTA}), updated_at = excluded.updated_at`
      )
      .bind(userId, templateId, now)
  )
  if (statements.length) await db.batch(statements)
  if (prefs) await savePrefs(db, userId, prefs)
}

/* ---------------- 发送 ---------------- */

/**
 * 发一条订阅消息。任何失败都只打日志 —— 调用方（投票、评论）已经写库了，
 * 推送失败不能把用户的正常操作变成 500。
 */
export async function pushNotification(
  env: Env,
  db: D1Database,
  userId: string,
  kind: PushKind,
  msg: { title: string; content: string; pollId?: string | null }
): Promise<void> {
  const templateId = templates(env)[kind]
  if (!templateId) return

  try {
    const prefs = await getPrefs(db, userId)
    if (!prefs.enabled || !prefs[kind]) return

    const quota = await db
      .prepare('SELECT remaining FROM wx_subscriptions WHERE user_id = ? AND template_id = ?')
      .bind(userId, templateId)
      .first<{ remaining: number }>()
    if (!quota || quota.remaining <= 0) return

    const openid = await db
      .prepare(
        `SELECT openid FROM user_platforms
         WHERE user_id = ? AND platform = 'weixin'
         ORDER BY created_at DESC LIMIT 1`
      )
      .bind(userId)
      .first<{ openid: string }>()
    if (!openid) return

    const f = fields(env)
    const data: Record<string, { value: string }> = {
      [f.title]: { value: clip(msg.title, 20) },
      [f.time]: { value: timeText(Date.now()) },
      [f.remark]: { value: clip(msg.content, 20) }
    }

    const res = await wxPost<{ errcode?: number; errmsg?: string }>(
      db,
      env,
      '/cgi-bin/message/subscribe/send',
      {
        touser: openid.openid,
        template_id: templateId,
        // 点通知直接落到详情页；链接模式/邀请码模式都能正常打开
        page: msg.pollId ? `pages/detail/index?id=${msg.pollId}` : undefined,
        data,
        miniprogram_state: miniprogramState(env.WX_ENV_VERSION),
        lang: 'zh_CN'
      }
    )

    if (res.errcode === 0) {
      await db
        .prepare(
          `UPDATE wx_subscriptions SET remaining = remaining - 1, updated_at = ?
           WHERE user_id = ? AND template_id = ? AND remaining > 0`
        )
        .bind(Date.now(), userId, templateId)
        .run()
    } else if (res.errcode === 43101) {
      // 43101 = 用户拒收 / 没有额度。清零，免得每次都白调一次接口
      await db
        .prepare(
          'UPDATE wx_subscriptions SET remaining = 0, updated_at = ? WHERE user_id = ? AND template_id = ?'
        )
        .bind(Date.now(), userId, templateId)
        .run()
    } else {
      console.warn('[push] 订阅消息发送失败', kind, res.errcode, res.errmsg)
    }
  } catch (err) {
    console.warn('[push] 订阅消息异常', kind, err)
  }
}
