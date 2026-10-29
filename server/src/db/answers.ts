import type { AnswerRow, Env, Paged, PollRowJoined, SurveyAnswerOut } from '../types'
import { newId } from '../lib/id'
import { HttpError } from '../lib/response'
import { assertCanJoin, isInviteOnly } from './invites'
import { notifyJoined } from './notifications'
import { assertPollOpen } from './polls'

const PAGE_SIZE = 20

function toAnswer(
  row: AnswerRow & { user_name?: string | null; user_avatar?: string | null },
  showUser: boolean,
  showProfile: boolean
): SurveyAnswerOut {
  return {
    id: row.id,
    pollId: row.poll_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at !== row.created_at ? row.updated_at : undefined,
    user:
      showUser && row.user_id
        ? { id: row.user_id, name: row.user_name ?? '', avatar: row.user_avatar ?? undefined }
        : undefined,
    profileInfo: showProfile ? (row.profile_info ?? undefined) : undefined
  }
}

export async function submitAnswer(
  db: D1Database,
  poll: PollRowJoined,
  userId: string,
  content: string,
  profileInfo: string | undefined,
  ip: string | null,
  env?: Env
): Promise<SurveyAnswerOut> {
  if (poll.type !== 'survey') throw new HttpError(400, '这不是问卷')
  assertPollOpen(poll)
  await assertCanJoin(db, poll, userId)

  // 问卷允许「跳过未答」：空提交也算一份，计入 answer_count，
  // 只是不参与汇总（summary 那边会把空内容忽略掉）
  const text = String(content ?? '').trim()
  if (text.length > 2000) throw new HttpError(400, '回答最多 2000 字')

  // 同一份问卷：不允许重复时只能有一条；允许重复时 seq 递增
  const prev = await db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(MAX(seq), 0) AS max_seq,
              (SELECT profile_info FROM answers
               WHERE poll_id = ? AND user_id = ? ORDER BY seq DESC LIMIT 1) AS last_profile
       FROM answers WHERE poll_id = ? AND user_id = ?`
    )
    .bind(poll.id, userId, poll.id, userId)
    .first<{ n: number; max_seq: number; last_profile: string | null }>()

  const count = prev?.n ?? 0
  if (count > 0 && !poll.allow_repeat) throw new HttpError(409, '你已经提交过了')

  // 和投票一样，必填的个人信息不能只靠前端拦；重复提交允许沿用上一次
  const info = String(profileInfo ?? '').trim()
  const storedInfo = info || prev?.last_profile || null
  if (poll.profile_field && !storedInfo) throw new HttpError(400, `请填写${poll.profile_field}`)
  if (info.length > 200) throw new HttpError(400, '个人信息最多 200 字')

  // 同 IP 限制：允许本人重复提交（allow_repeat），只拦同一网络下的其他人
  if (poll.limit_ip && ip) {
    const dup = await db
      .prepare('SELECT 1 AS x FROM answers WHERE poll_id = ? AND ip = ? AND user_id != ? LIMIT 1')
      .bind(poll.id, ip, userId)
      .first()
    if (dup) throw new HttpError(409, '同一网络下只能提交一次')
  }

  const now = Date.now()
  const id = newId('a')
  await db.batch([
    db
      .prepare(
        `INSERT INTO answers (id, poll_id, user_id, seq, content, profile_info, ip, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .bind(id, poll.id, userId, (prev?.max_seq ?? 0) + 1, text, storedInfo, ip, now, now),
    db
      .prepare('UPDATE polls SET answer_count = answer_count + 1 WHERE id = ?')
      .bind(poll.id)
  ])

  // 回答已经写入，通知失败不能反过来让提交报错
  await notifyJoined(db, poll, userId, 'answer', text, env).catch((err) =>
    console.error('[notify] answer joined failed', err)
  )

  return {
    id,
    pollId: poll.id,
    content: text,
    createdAt: now,
    user: undefined,
    profileInfo: storedInfo || undefined
  }
}

export async function updateAnswer(
  db: D1Database,
  poll: PollRowJoined,
  userId: string,
  answerId: string,
  content: string
): Promise<SurveyAnswerOut> {
  assertPollOpen(poll)
  if (!poll.allow_edit) throw new HttpError(403, '发起人未开启修改回答')

  const text = String(content ?? '').trim()
  if (!text) throw new HttpError(400, '回答不能为空')
  if (text.length > 2000) throw new HttpError(400, '回答最多 2000 字')

  const row = await db
    .prepare('SELECT * FROM answers WHERE id = ? AND poll_id = ?')
    .bind(answerId, poll.id)
    .first<AnswerRow>()
  if (!row) throw new HttpError(404, '回答不存在')
  if (row.user_id !== userId) throw new HttpError(403, '只能修改自己的回答')

  const now = Date.now()
  await db.batch([
    db
      .prepare('UPDATE answers SET content = ?, updated_at = ? WHERE id = ?')
      .bind(text, now, answerId),
    // 回答正文变了，原来的汇总归类就不再成立。
    // 删掉这条 assignment，下次打开汇总时会按新内容重新归并，
    // 否则旧选项下会挂着一条已经改过的回答，统计和原文对不上。
    db
      .prepare('DELETE FROM summary_assignments WHERE answer_id = ? AND poll_id = ?')
      .bind(answerId, poll.id)
  ])

  return toAnswer({ ...row, content: text, updated_at: now }, false, true)
}

/**
 * 问卷回答列表（发起人视角）
 *
 * 匿名收集时不返回回答人；profileInfo 只有发起人能看。
 */
export async function listAnswers(
  db: D1Database,
  poll: PollRowJoined,
  viewerId: string | null,
  cursor?: string | null
): Promise<Paged<SurveyAnswerOut>> {
  const offset = Math.max(0, Number(cursor) || 0)
  const isOwner = poll.creator_id === viewerId
  const showUser = !poll.anonymous

  // 回答正文只对发起人和提交过回答的人开放：
  // 链接模式也不能靠「知道 poll id」就把所有人的回答读走。
  if (!isOwner) {
    if (!viewerId) throw new HttpError(403, '提交回答后才能查看')
    if (isInviteOnly(poll)) await assertCanJoin(db, poll, viewerId)
    const mine = await db
      .prepare('SELECT 1 AS x FROM answers WHERE poll_id = ? AND user_id = ? LIMIT 1')
      .bind(poll.id, viewerId)
      .first()
    if (!mine) throw new HttpError(403, '提交回答后才能查看')
  }

  const totalRow = await db
    .prepare('SELECT COUNT(*) AS n FROM answers WHERE poll_id = ?')
    .bind(poll.id)
    .first<{ n: number }>()
  const total = totalRow?.n ?? 0

  const { results } = await db
    .prepare(
      `SELECT a.*, u.nickname AS user_name, u.avatar AS user_avatar
       FROM answers a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.poll_id = ?
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(poll.id, PAGE_SIZE, offset)
    .all<AnswerRow & { user_name: string | null; user_avatar: string | null }>()

  const list = results.map((r) => toAnswer(r, showUser, isOwner))
  const next = offset + list.length
  return { list, cursor: next < total ? String(next) : null, hasMore: next < total, total }
}

/** 我在这份问卷里的回答（71 我的提交记录），按时间倒序 */
export async function myAnswers(
  db: D1Database,
  pollId: string,
  userId: string
): Promise<SurveyAnswerOut[]> {
  const { results } = await db
    .prepare('SELECT * FROM answers WHERE poll_id = ? AND user_id = ? ORDER BY created_at DESC')
    .bind(pollId, userId)
    .all<AnswerRow>()
  return results.map((r) => toAnswer(r, false, true))
}
