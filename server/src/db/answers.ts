import type { AnswerRow, Paged, PollRowJoined, SurveyAnswerOut } from '../types'
import { newId } from '../lib/id'
import { HttpError } from '../lib/response'
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
  profileInfo: string | undefined
): Promise<SurveyAnswerOut> {
  if (poll.type !== 'survey') throw new HttpError(400, '这不是问卷')
  assertPollOpen(poll)

  const text = (content ?? '').trim()
  if (!text) throw new HttpError(400, '回答不能为空')
  if (text.length > 2000) throw new HttpError(400, '回答最多 2000 字')

  // 同一份问卷：不允许重复时只能有一条；允许重复时 seq 递增
  const prev = await db
    .prepare('SELECT COUNT(*) AS n, COALESCE(MAX(seq), 0) AS max_seq FROM answers WHERE poll_id = ? AND user_id = ?')
    .bind(poll.id, userId)
    .first<{ n: number; max_seq: number }>()

  const count = prev?.n ?? 0
  if (count > 0 && !poll.allow_repeat) throw new HttpError(409, '你已经提交过了')

  const now = Date.now()
  const id = newId('a')
  await db.batch([
    db
      .prepare(
        `INSERT INTO answers (id, poll_id, user_id, seq, content, profile_info, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .bind(id, poll.id, userId, (prev?.max_seq ?? 0) + 1, text, profileInfo ?? null, now, now),
    db
      .prepare('UPDATE polls SET answer_count = answer_count + 1 WHERE id = ?')
      .bind(poll.id)
  ])

  return {
    id,
    pollId: poll.id,
    content: text,
    createdAt: now,
    user: undefined,
    profileInfo: profileInfo ?? undefined
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

  const text = (content ?? '').trim()
  if (!text) throw new HttpError(400, '回答不能为空')
  if (text.length > 2000) throw new HttpError(400, '回答最多 2000 字')

  const row = await db
    .prepare('SELECT * FROM answers WHERE id = ? AND poll_id = ?')
    .bind(answerId, poll.id)
    .first<AnswerRow>()
  if (!row) throw new HttpError(404, '回答不存在')
  if (row.user_id !== userId) throw new HttpError(403, '只能修改自己的回答')

  const now = Date.now()
  await db
    .prepare('UPDATE answers SET content = ?, updated_at = ? WHERE id = ?')
    .bind(text, now, answerId)
    .run()

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
