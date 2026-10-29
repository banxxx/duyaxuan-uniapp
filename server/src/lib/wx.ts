import { HttpError } from './response'
import type { Env } from '../types'

/**
 * 微信服务端接口的公共部分
 *
 * access_token 有频率限制，必须缓存；Worker 没有跨请求内存，缓存在 D1 的 wx_tokens。
 * 小程序码和订阅消息共用同一份 token —— 两边各拿一次会把对方顶掉，
 * 被顶掉的那次就会报 40001。
 */

const TOKEN_KEY = 'default'
/** 提前 60 秒过期，避免边界上拿到刚失效的 token */
const TOKEN_MARGIN = 60_000

interface TokenRow {
  value: string
  expires_at: number
}

export async function accessToken(db: D1Database, appid: string, secret: string): Promise<string> {
  if (!appid || !secret) throw new HttpError(501, '还没配置微信 AppID / AppSecret')

  const now = Date.now()
  const row = await db
    .prepare('SELECT value, expires_at FROM wx_tokens WHERE key = ?')
    .bind(TOKEN_KEY)
    .first<TokenRow>()
  if (row && row.expires_at > now + TOKEN_MARGIN) return row.value

  const res = await fetch(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`
  )
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string
    expires_in?: number
    errcode?: number
    errmsg?: string
  }

  if (!data.access_token) {
    // 40164 = 调用 IP 不在白名单。Workers 出口 IP 不固定，只能关掉白名单
    const hint =
      data.errcode === 40164
        ? '微信后台开启了 IP 白名单，Cloudflare Workers 出口 IP 会变，请在微信后台关闭白名单'
        : data.errmsg || '获取 access_token 失败'
    throw new HttpError(502, hint)
  }

  const expiresAt = now + (data.expires_in ?? 7200) * 1000
  await db
    .prepare(
      `INSERT INTO wx_tokens (key, value, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`
    )
    .bind(TOKEN_KEY, data.access_token, expiresAt)
    .run()

  return data.access_token
}

/** token 被别处顶掉时清掉缓存，下一次重新申请 */
export async function resetAccessToken(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM wx_tokens WHERE key = ?').bind(TOKEN_KEY).run()
}

/** 环境版本只接受微信认的三个值，写错就当正式版 */
export function envVersion(raw: string | undefined): 'release' | 'trial' | 'develop' {
  return raw === 'trial' || raw === 'develop' ? raw : 'release'
}

/** 订阅消息里的 miniprogram_state，和 env_version 是同一件事的两种叫法 */
export function miniprogramState(raw: string | undefined): 'developer' | 'trial' | 'formal' {
  const version = envVersion(raw)
  return version === 'develop' ? 'developer' : version === 'trial' ? 'trial' : 'formal'
}

interface WxResult {
  errcode?: number
  errmsg?: string
}

/**
 * 带 access_token 的 POST。
 *
 * 40001 / 42001 表示 token 失效（可能是另一台机器刚申请过），
 * 清掉缓存重试一次；重试后还失败就把结果原样返回，让调用方决定怎么处理。
 */
export async function wxPost<T extends WxResult>(
  db: D1Database,
  env: Env,
  path: string,
  body: unknown,
  retry = true
): Promise<T> {
  const token = await accessToken(db, env.WX_APPID, env.WX_SECRET)
  const res = await fetch(
    `https://api.weixin.qq.com${path}?access_token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // 微信接口偶尔会卡住；推送不能把投票请求一起拖死
      signal: AbortSignal.timeout(2500)
    }
  )
  const data = (await res.json().catch(() => ({}))) as T
  if (retry && (data.errcode === 40001 || data.errcode === 42001)) {
    await resetAccessToken(db)
    return wxPost<T>(db, env, path, body, false)
  }
  return data
}
