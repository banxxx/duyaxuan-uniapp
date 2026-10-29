import { newId } from '../lib/id'
import { isPushKind, pushNotification } from './push'
import type { Env, PollRowJoined } from '../types'

/**
 * 通知
 *
 * 两层：
 *   1. 站内消息（notifications 表）—— 进小程序点铃铛才看得到，始终写
 *   2. 微信订阅消息 —— 用户授权过、还有额度时才发一条服务通知（db/push.ts）
 *
 * 第二层是可选的：没配模板 ID 就只写站内消息，开发期不用去申请模板。
 * env 是可选参数，内部调用（种子、脚本）不传就不会碰微信接口。
 */

export type NotificationKind = 'deadline' | 'comment' | 'result' | 'joined' | 'published'

const PAGE_SIZE = 20
const PREVIEW = 24

export interface NotifyInput {
  userId: string
  kind: NotificationKind
  title: string
  content?: string
  pollId?: string
  actorId?: string
}

/** 列表里内容最多露两行，长的截断，正文去换行 */
function preview(text: string | null | undefined): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > PREVIEW ? `${t.slice(0, PREVIEW)}…` : t
}

async function nicknameOf(db: D1Database, userId: string): Promise<string> {
  const row = await db
    .prepare('SELECT nickname FROM users WHERE id = ?')
    .bind(userId)
    .first<{ nickname: string }>()
  return row?.nickname || '有人'
}

export async function notify(
  db: D1Database,
  input: NotifyInput,
  env?: Env
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO notifications (id, user_id, kind, title, content, poll_id, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      newId('n'),
      input.userId,
      input.kind,
      input.title,
      input.content ?? null,
      input.pollId ?? null,
      input.actorId ?? null,
      Date.now()
    )
    .run()

  // 站内消息已经写进去了，订阅消息发不发都不影响这条记录
  if (env && isPushKind(input.kind)) {
    await pushNotification(env, db, input.userId, input.kind, {
      title: input.title,
      content: input.content ?? input.title,
      pollId: input.pollId
    })
  }
}

/* ---------------- 业务事件 → 通知 ---------------- */

/** 有人投票 / 提交回答：只通知发起人，自己投自己的不通知 */
export async function notifyJoined(
  db: D1Database,
  poll: PollRowJoined,
  actorId: string,
  action: 'vote' | 'answer',
  answerContent?: string,
  env?: Env
): Promise<void> {
  if (poll.creator_id === actorId) return
  const name = await nicknameOf(db, actorId)
  const content =
    action === 'vote'
      ? `${name} 在「${poll.title}」投了一票`
      : `${name} 提交了「${poll.title}」的回答${answerContent ? `：${preview(answerContent)}` : ''}`
  await notify(
    db,
    {
      userId: poll.creator_id,
      kind: 'joined',
      title: action === 'vote' ? '有人参与了你的投票' : '收到新的回答',
      content,
      pollId: poll.id,
      actorId
    },
    env
  )
}

/**
 * 新评论：发起人收一条；如果是回复，被回复的人再收一条。
 * 两边可能重合（发起人回复自己），用 Set 去重，避免同一条通知发两次。
 */
export async function notifyComment(
  db: D1Database,
  poll: PollRowJoined,
  actorId: string,
  content: string,
  replyToUserId?: string | null,
  env?: Env
): Promise<void> {
  const name = await nicknameOf(db, actorId)
  const recipients = new Map<string, { title: string; content: string }>()

  if (poll.creator_id !== actorId) {
    recipients.set(poll.creator_id, {
      title: '新的评论',
      content: `${name} 评论了「${poll.title}」：${preview(content)}`
    })
  }
  if (replyToUserId && replyToUserId !== actorId) {
    recipients.set(replyToUserId, {
      title: `${name} 回复了你`,
      content: `「${poll.title}」：${preview(content)}`
    })
  }

  for (const [userId, n] of recipients) {
    await notify(
      db,
      {
        userId,
        kind: 'comment',
        title: n.title,
        content: n.content,
        pollId: poll.id,
        actorId
      },
      env
    )
  }
}

/* ---------------- 44 消息列表 ---------------- */

export async function listNotifications(
  db: D1Database,
  userId: string,
  cursor?: string | null,
  env?: Env
) {
  await flushDueReminders(db, userId, env)

  const before = cursor ? Number(cursor) : null
  const where = before ? 'AND created_at < ?' : ''
  const binds: Array<string | number> = before
    ? [userId, before, PAGE_SIZE + 1]
    : [userId, PAGE_SIZE + 1]

  const { results } = await db
    .prepare(
      `SELECT id, user_id, kind, title, content, poll_id, actor_id, read_at, created_at
       FROM notifications WHERE user_id = ? ${where}
       ORDER BY created_at DESC LIMIT ?`
    )
    .bind(...binds)
    .all<{
      id: string
      user_id: string
      kind: string
      title: string
      content: string | null
      poll_id: string | null
      actor_id: string | null
      read_at: number | null
      created_at: number
    }>()

  const hasMore = results.length > PAGE_SIZE
  const page = hasMore ? results.slice(0, PAGE_SIZE) : results
  const countRow = await db
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>()

  return {
    list: page.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      content: n.content ?? '',
      pollId: n.poll_id ?? undefined,
      createdAt: n.created_at,
      read: n.read_at !== null
    })),
    cursor: hasMore ? String(page[page.length - 1].created_at) : null,
    hasMore,
    total: countRow?.n ?? page.length
  }
}

export async function unreadCount(
  db: D1Database,
  userId: string,
  env?: Env
): Promise<number> {
  await flushDueReminders(db, userId, env)
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL')
    .bind(userId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

/** 传入 ids 只标这几条；不传就全部已读 */
export async function markRead(
  db: D1Database,
  userId: string,
  ids?: string[] | null,
  env?: Env
): Promise<number> {
  const now = Date.now()
  if (ids && ids.length) {
    const marks = ids.map(() => '?').join(',')
    await db
      .prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND id IN (${marks}) AND read_at IS NULL`)
      .bind(now, userId, ...ids)
      .run()
  } else {
    await db
      .prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
      .bind(now, userId)
      .run()
  }
  return unreadCount(db, userId, env)
}

/** 「提醒我」：截止后补发一条截止通知，补完把提醒删掉，避免重复 */
export async function remindMe(db: D1Database, pollId: string, userId: string): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO poll_reminders (poll_id, user_id, created_at) VALUES (?, ?, ?)')
    .bind(pollId, userId, Date.now())
    .run()
}

async function flushDueReminders(
  db: D1Database,
  userId: string,
  env?: Env
): Promise<void> {
  const now = Date.now()
  const { results } = await db
    .prepare(
      `SELECT r.poll_id, p.title
       FROM poll_reminders r JOIN polls p ON p.id = r.poll_id
       WHERE r.user_id = ? AND p.deleted_at IS NULL AND (p.status = 1 OR p.end_at <= ?)`
    )
    .bind(userId, now)
    .all<{ poll_id: string; title: string }>()
  if (!results.length) return

  const statements = results.map((r) =>
    db
      .prepare(
        `INSERT INTO notifications (id, user_id, kind, title, content, poll_id, created_at)
         VALUES (?, ?, 'deadline', '投票已结束', ?, ?, ?)`
      )
      .bind(newId('n'), userId, `「${r.title}」已经结束，去看看结果吧`, r.poll_id, now)
  )
  statements.push(
    db
      .prepare('DELETE FROM poll_reminders WHERE user_id = ? AND poll_id IN (' +
        results.map(() => '?').join(',') + ')')
      .bind(userId, ...results.map((r) => r.poll_id))
  )
  await db.batch(statements)

  // 站内消息补发之后顺手推一条订阅消息（有模板、有额度才真的发）
  if (env) {
    for (const r of results) {
      await pushNotification(env, db, userId, 'deadline', {
        title: '投票已结束',
        content: `「${r.title}」已经结束，去看看结果吧`,
        pollId: r.poll_id
      })
    }
  }
}
