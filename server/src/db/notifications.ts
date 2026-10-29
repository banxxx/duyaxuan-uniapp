import { newId } from '../lib/id'
import { pollTypeLabel } from '../lib/poll-type'
import { HttpError } from '../lib/response'
import { assertCanJoin } from './invites'
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

export type NotificationKind =
  | 'deadline'
  | 'comment'
  | 'result'
  | 'joined'
  | 'published'
  | 'updated'

const PAGE_SIZE = 20
const PREVIEW = 24

export interface NotifyInput {
  userId: string
  kind: NotificationKind
  title: string
  content?: string
  pollId?: string
  actorId?: string
  /** 订阅消息的「活动名称」：单选投票 / 多选投票 / 问卷收集 */
  pushActivity?: string
  /** 订阅消息的「活动内容」：投票 / 问卷标题 */
  pushContent?: string
  /** 只写站内消息，不推微信服务通知（参与通知只在第一次推） */
  skipPush?: boolean
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
  // result 通知有唯一索引兜底：并发结束 / 补发时第二个请求会命中冲突，
  // 这条没写进去就不再推送，避免同一个人收到两条「结果已公布」。
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO notifications (id, user_id, kind, title, content, poll_id, actor_id, created_at)
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
  if (inserted.meta.changes === 0) return

  // 站内消息已经写进去了，订阅消息发不发都不影响这条记录。
  // 订阅模板是「活动名称 / 活动内容 / 活动日期」：
  // 名称 = 投票类型，内容 = 投票标题（没传就退回站内消息的标题）。
  if (env && isPushKind(input.kind) && !input.skipPush) {
    await pushNotification(env, db, input.userId, input.kind, {
      activity: input.pushActivity ?? input.title,
      content: input.pushContent ?? input.title,
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
  // 匿名投票 / 问卷：连发起人也不该从消息里认出是谁。
  // 投票记录页已经按 anonymous 隐藏了身份，通知这里必须一致。
  const anonymous = !!poll.anonymous
  const name = anonymous ? '有人' : await nicknameOf(db, actorId)
  const content =
    action === 'vote'
      ? anonymous
        ? `有人在「${poll.title}」投了一票`
        : `${name} 在「${poll.title}」投了一票`
      : anonymous
        ? `有人提交了「${poll.title}」的回答`
        : `${name} 提交了「${poll.title}」的回答${answerContent ? `：${preview(answerContent)}` : ''}`

  // 站内消息每条都写；微信推送只在第一次参与时发。
  // 订阅额度是共享的，每票都推会把「截止提醒 / 结果公布」的额度吃光。
  // poll 是写入前取的，voter_count / answer_count 还没 +1。
  const first = action === 'vote' ? poll.voter_count === 0 : poll.answer_count === 0

  await notify(
    db,
    {
      userId: poll.creator_id,
      kind: 'joined',
      title: action === 'vote' ? '有人参与了你的投票' : '收到新的回答',
      content,
      pollId: poll.id,
      actorId,
      pushActivity: pollTypeLabel(poll.type),
      pushContent: poll.title,
      skipPush: !first
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
        actorId,
        pushActivity: pollTypeLabel(poll.type),
        pushContent: poll.title
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
  await flushDueResults(db, userId, env)

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
  await flushDueResults(db, userId, env)
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
    // 和汇总一样按 90 个一批，避免超过 D1 单条 SQL 的 100 个绑定参数上限。
    const unique = [...new Set(ids)].slice(0, 500)
    for (let i = 0; i < unique.length; i += 90) {
      const chunk = unique.slice(i, i + 90)
      const marks = chunk.map(() => '?').join(',')
      await db
        .prepare(
          `UPDATE notifications SET read_at = ? WHERE user_id = ? AND id IN (${marks}) AND read_at IS NULL`
        )
        .bind(now, userId, ...chunk)
        .run()
    }
  } else {
    await db
      .prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
      .bind(now, userId)
      .run()
  }
  return unreadCount(db, userId, env)
}

/** 提前多久提醒：结束前 2 小时 */
const REMIND_WINDOW = 2 * 3600_000

/** 「提醒我」：结束前 2 小时提醒，补完把提醒删掉，避免重复 */
export async function remindMe(
  db: D1Database,
  poll: PollRowJoined,
  userId: string
): Promise<void> {
  // 已经结束、或总时长不足 2 小时的投票没有「结束前 2 小时」这个时间点，
  // 直接拒绝，避免用户看到「已设置」却永远收不到提醒。
  if (poll.status === 1 || poll.end_at <= Date.now()) {
    throw new HttpError(400, '投票已结束')
  }
  if (poll.end_at - poll.created_at <= REMIND_WINDOW) {
    throw new HttpError(400, '投票时长不足 2 小时，无需提醒')
  }
  // 邀请制投票只给发起人和已受邀的人设提醒，别让外人订阅到标题和截止时间
  await assertCanJoin(db, poll, userId)
  await db
    .prepare('INSERT OR IGNORE INTO poll_reminders (poll_id, user_id, created_at) VALUES (?, ?, ?)')
    .bind(poll.id, userId, Date.now())
    .run()
}

/**
 * 补发截止提醒。
 *
 * 没有定时任务，只能等用户下次拉通知时判断：
 *   - 投票总时长不超过 2 小时 → 不提醒（提醒点会落在开始之前）
 *   - 进入结束前 2 小时，或已经结束 → 发一条，然后删掉提醒
 */
async function flushDueReminders(
  db: D1Database,
  userId: string,
  env?: Env,
  pushLimit = 3
): Promise<void> {
  const now = Date.now()
  const { results } = await db
    .prepare(
      `SELECT r.poll_id, p.title, p.type, p.created_at, p.end_at, p.status
       FROM poll_reminders r JOIN polls p ON p.id = r.poll_id
       WHERE r.user_id = ? AND p.deleted_at IS NULL`
    )
    .bind(userId)
    .all<{
      poll_id: string
      title: string
      type: string
      created_at: number
      end_at: number
      status: number
    }>()
  if (!results.length) return

  const due: typeof results = []
  const drop: typeof results = []
  for (const r of results) {
    if (r.end_at - r.created_at <= REMIND_WINDOW) {
      drop.push(r)
      continue
    }
    if (r.status === 1 || now >= r.end_at - REMIND_WINDOW) due.push(r)
  }

  const finished = [...due, ...drop]
  if (!finished.length) return

  const statements = due.map((r) => {
    const ended = r.status === 1 || now >= r.end_at
    const isSurvey = r.type === 'survey'
    const noun = isSurvey ? '问卷' : '投票'
    return db
      .prepare(
        `INSERT INTO notifications (id, user_id, kind, title, content, poll_id, created_at)
         VALUES (?, ?, 'deadline', ?, ?, ?, ?)`
      )
      .bind(
        newId('n'),
        userId,
        ended ? `${noun}已结束` : `${noun}即将结束`,
        ended
          ? isSurvey
            ? `「${r.title}」已经结束，去看看汇总吧`
            : `「${r.title}」已经结束，去看看结果吧`
          : `「${r.title}」还有不到 2 小时结束，${isSurvey ? '去填写吧' : '去看看吧'}`,
        r.poll_id,
        now
      )
  })
  statements.push(
    db
      .prepare(
        'DELETE FROM poll_reminders WHERE user_id = ? AND poll_id IN (' +
          finished.map(() => '?').join(',') + ')'
      )
      .bind(userId, ...finished.map((r) => r.poll_id))
  )
  await db.batch(statements)

  // 站内消息补发之后顺手推订阅消息（有模板、有额度才真的发）。
  // 单次最多推 pushLimit 条：一个用户可能同时有很多条到点提醒，
  // 全部推会占满免费套餐的子请求额度，导致这次请求直接失败。
  if (env) {
    for (const r of due.slice(0, pushLimit)) {
      await pushNotification(env, db, userId, 'deadline', {
        activity: pollTypeLabel(r.type),
        content: r.title,
        pollId: r.poll_id
      })
    }
  }
}

/* ---------------- 结束 / 结果公布 ---------------- */

/**
 * 投票/问卷结束后的结果通知。
 *
 * 收件人：
 *   - 发起人：投票、问卷都通知（自己的内容结束了，结果总要看一下）
 *   - 参与者：只通知投票（投过票的人），问卷不发
 *   - 结果不公开（result_visibility = 'hidden'）时参与者不发 ——
 *     说了「已公布」他也看不到
 */
export async function notifyPollEnded(
  db: D1Database,
  poll: PollRowJoined,
  env?: Env,
  /**
   * 微信推送最多发多少人。
   *
   * 站内消息按每 50 条一个 batch 批量写入（单次最多 400 条），不受这个上限影响；
   * 订阅消息每次调用都是一次微信接口 + 几次 D1 读写，免费套餐单次只有
   * 50 个子请求，所以只推前几个人。发起人排在最前面，保证他自己的
   * 「已结束」通知一定先推；没推到的用户仍能在消息中心看到结果通知。
   */
  pushLimit = 4
): Promise<void> {
  const isSurvey = poll.type === 'survey'
  const total = isSurvey ? poll.answer_count : poll.voter_count
  const countText = isSurvey ? `共 ${total} 份回答` : `共 ${total} 人参与`
  const recipients = new Map<string, boolean>() // userId → 是否发起人
  recipients.set(poll.creator_id, true)

  if (!isSurvey && poll.result_visibility !== 'hidden') {
    const { results } = await db
      .prepare('SELECT DISTINCT user_id FROM votes WHERE poll_id = ?')
      .bind(poll.id)
      .all<{ user_id: string }>()
    for (const r of results) {
      if (!recipients.has(r.user_id)) recipients.set(r.user_id, false)
    }
  }

  // 提前结束和「自然到期补发」都会走到这里，一次查出已经收到通知的人，
  // 不再对每个收件人各做一次 SELECT。
  const { results: doneRows } = await db
    .prepare("SELECT user_id FROM notifications WHERE poll_id = ? AND kind = 'result'")
    .bind(poll.id)
    .all<{ user_id: string }>()
  const done = new Set(doneRows.map((r) => r.user_id))
  const targets = [...recipients].filter(([userId]) => !done.has(userId))
  if (!targets.length) return

  // 单次最多写 400 条站内消息（8 个 batch）。再多的话剩下的由 Cron /
  // 用户下次拉通知时补，避免一次调用把免费套餐的 50 个子请求用光。
  const stationTargets = targets.slice(0, 400)
  const now = Date.now()
  // 并发结束 / Cron 补发时，另一个请求可能刚好写过同一条 result 通知。
  // INSERT OR IGNORE + 唯一索引保证不重复；只有真正写进去的人才推送。
  const inserted = new Set<string>()
  for (let i = 0; i < stationTargets.length; i += 50) {
    const slice = stationTargets.slice(i, i + 50)
    const res = await db.batch(
      slice.map(([userId, creator]) => {
        const title = creator
          ? isSurvey
            ? '你的问卷已结束'
            : '你的投票已结束'
          : '投票结果已公布'
        const content = creator
          ? isSurvey
            ? `「${poll.title}」已结束，${countText}，去看看汇总吧`
            : `「${poll.title}」已结束，${countText}，去看看结果吧`
          : `「${poll.title}」的结果已经公布，${countText}`

        return db
          .prepare(
            `INSERT OR IGNORE INTO notifications (id, user_id, kind, title, content, poll_id, actor_id, created_at)
             VALUES (?, ?, 'result', ?, ?, ?, NULL, ?)`
          )
          .bind(newId('n'), userId, title, content, poll.id, now)
      })
    )
    res.forEach((r, j) => {
      if (r.meta.changes > 0) inserted.add(slice[j][0])
    })
  }

  // 站内消息已经全部落库，微信推送只补前几个，失败也不影响结果通知
  if (env) {
    for (const [userId] of stationTargets.slice(0, pushLimit)) {
      if (!inserted.has(userId)) continue
      await pushNotification(env, db, userId, 'result', {
        activity: pollTypeLabel(poll.type),
        content: poll.title,
        pollId: poll.id
      })
    }
  }
}

/**
 * 自然到期的补发：没有定时任务，用户下次拉通知时，把「已结束但我还没收到
 * 结果通知」的补上。去重靠 notifications 里已有的 kind='result' 行。
 */
async function flushDueResults(
  db: D1Database,
  userId: string,
  env?: Env,
  limit = 5
): Promise<void> {
  const now = Date.now()
  const { results } = await db
    .prepare(
      `SELECT p.id, p.title, p.type, p.creator_id, p.result_visibility,
              p.voter_count, p.answer_count
       FROM polls p
       WHERE p.deleted_at IS NULL
         AND (p.status = 1 OR p.end_at <= ?)
         AND (
           p.creator_id = ?
           OR (
             p.type != 'survey'
             AND p.result_visibility != 'hidden'
             AND EXISTS (
               SELECT 1 FROM votes v WHERE v.poll_id = p.id AND v.user_id = ?
             )
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.poll_id = p.id AND n.user_id = ? AND n.kind = 'result'
         )
       LIMIT ?`
    )
    .bind(now, userId, userId, userId, limit)
    .all<{
      id: string
      title: string
      type: string
      creator_id: string
      result_visibility: string
      voter_count: number
      answer_count: number
    }>()

  for (const p of results) {
    const creator = p.creator_id === userId
    if (!creator && p.result_visibility === 'hidden') continue

    const isSurvey = p.type === 'survey'
    const total = isSurvey ? p.answer_count : p.voter_count
    const countText = isSurvey ? `共 ${total} 份回答` : `共 ${total} 人参与`
    const title = creator
      ? isSurvey
        ? '你的问卷已结束'
        : '你的投票已结束'
      : '投票结果已公布'
    const content = creator
      ? isSurvey
        ? `「${p.title}」已结束，${countText}，去看看汇总吧`
        : `「${p.title}」已结束，${countText}，去看看结果吧`
      : `「${p.title}」的结果已经公布，${countText}`

    await notify(
      db,
      {
        userId,
        kind: 'result',
        title,
        content,
        pollId: p.id,
        pushActivity: pollTypeLabel(p.type),
        pushContent: p.title
      },
      env
    )
  }
}

/* ---------------- 定时补发（Cron Trigger） ---------------- */

/**
 * Cron 入口：没有用户请求时，也把到点的截止提醒、自然到期的结果通知发出去。
 *
 * 每轮只挑少量用户处理：
 *   - Workers Free 每次调用只有 50 个子请求、10ms CPU，一次扫全库会超；
 *   - 处理不完不要紧：提醒发完会删掉，结果通知靠「已有 result 通知」去重，
 *     下一轮（5 分钟后）接着处理剩下的。
 *
 * 没配 Cron Trigger 时这个函数不会被调用，用户拉通知时仍会补发（见上面）。
 */
// 免费套餐每次 Cron 只有 50 个子请求。一轮最多处理 2 个用户的提醒 +
// 2 个用户的结果通知，每人最多推 1 条，剩下的下一轮继续。
const CRON_USERS = 2
const CRON_POLLS_PER_USER = 1
const CRON_PUSH_PER_USER = 1

export async function flushScheduled(env: Env): Promise<void> {
  const db = env.DB
  const now = Date.now()

  // 0. 清掉已删除投票留下的提醒，否则它们永远不会被选中，只会一直堆着
  await db
    .prepare(
      'DELETE FROM poll_reminders WHERE poll_id IN (SELECT id FROM polls WHERE deleted_at IS NOT NULL)'
    )
    .run()

  // 1. 截止提醒：挑「有提醒已到点 / 已结束 / 时长不足 2 小时该丢弃」的用户
  const reminderUsers = await db
    .prepare(
      `SELECT DISTINCT r.user_id
       FROM poll_reminders r JOIN polls p ON p.id = r.poll_id
       WHERE p.deleted_at IS NULL
         AND (p.end_at - p.created_at <= ? OR p.status = 1 OR p.end_at - ? <= ?)
       LIMIT ?`
    )
    .bind(REMIND_WINDOW, REMIND_WINDOW, now, CRON_USERS)
    .all<{ user_id: string }>()
  for (const r of reminderUsers.results) {
    await flushDueReminders(db, r.user_id, env, CRON_PUSH_PER_USER)
  }

  // 2. 结果通知：挑「已结束、但本人还没收到结果通知」的发起人 / 参与者
  const resultUsers = await db
    .prepare(
      `SELECT DISTINCT user_id FROM (
         SELECT p.creator_id AS user_id
         FROM polls p
         WHERE p.deleted_at IS NULL AND (p.status = 1 OR p.end_at <= ?)
           AND NOT EXISTS (
             SELECT 1 FROM notifications n
             WHERE n.poll_id = p.id AND n.user_id = p.creator_id AND n.kind = 'result'
           )
         UNION
         SELECT v.user_id
         FROM votes v JOIN polls p ON p.id = v.poll_id
         WHERE p.deleted_at IS NULL AND (p.status = 1 OR p.end_at <= ?)
           AND p.type != 'survey' AND p.result_visibility != 'hidden'
           AND NOT EXISTS (
             SELECT 1 FROM notifications n
             WHERE n.poll_id = p.id AND n.user_id = v.user_id AND n.kind = 'result'
           )
       )
       LIMIT ?`
    )
    .bind(now, now, CRON_USERS)
    .all<{ user_id: string }>()
  for (const r of resultUsers.results) {
    await flushDueResults(db, r.user_id, env, CRON_POLLS_PER_USER)
  }
}

/* ---------------- 内容更新 ---------------- */

/**
 * 发起人改了投票 / 问卷：通知参与过的人（投过票或答过卷），发起人自己不发。
 * 调用方（updatePoll）已经判断过「确实有改动」，这里只负责发。
 */
export async function notifyPollUpdated(
  db: D1Database,
  pollId: string,
  type: string,
  title: string,
  creatorId: string,
  env?: Env
): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT user_id FROM (
         SELECT user_id FROM votes WHERE poll_id = ?
         UNION
         SELECT user_id FROM answers WHERE poll_id = ?
       )`
    )
    .bind(pollId, pollId)
    .all<{ user_id: string }>()
  const allRecipients = results.map((r) => r.user_id).filter((id) => id !== creatorId)
  if (!allRecipients.length) return

  // 同结果通知：单次最多写 400 条站内消息（8 个 batch），
  // 避免大投票编辑一次就把免费套餐的 50 个子请求用光、接口直接 500。
  const recipients = allRecipients.slice(0, 400)
  const isSurvey = type === 'survey'
  const nTitle = isSurvey ? '问卷内容有更新' : '投票内容有更新'
  const nContent = `「${title}」有更新，去看看`
  const now = Date.now()

  // 站内消息批量写入（每 50 条一个 batch），人多也不会逐个占子请求
  for (let i = 0; i < recipients.length; i += 50) {
    await db.batch(
      recipients.slice(i, i + 50).map((userId) =>
        db
          .prepare(
            `INSERT INTO notifications (id, user_id, kind, title, content, poll_id, actor_id, created_at)
             VALUES (?, ?, 'updated', ?, ?, ?, NULL, ?)`
          )
          .bind(newId('n'), userId, nTitle, nContent, pollId, now)
      )
    )
  }

  // 微信推送受免费套餐 50 个子请求限制，单次最多推 4 条；
  // 没推到的用户仍能在消息中心看到这条更新。
  if (env) {
    for (const userId of recipients.slice(0, 4)) {
      await pushNotification(env, db, userId, 'updated', {
        activity: pollTypeLabel(type),
        content: title,
        pollId
      })
    }
  }
}
