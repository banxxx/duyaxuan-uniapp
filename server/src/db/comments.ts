import { newId } from '../lib/id'
import { HttpError } from '../lib/response'
import type { Env } from '../types'
import { notifyComment } from './notifications'
import { getPollRowOrThrow } from './polls'

/**
 * 评论区
 *
 * 评论是公开内容，列表允许匿名浏览（详情页未登录也能看讨论），
 * 发评论 / 点赞 / 删除才要求登录。
 *
 * 楼层只做一级：回复某条评论时把 reply_to_id 存下来，展示成「回复 xx：」，
 * 不做无限嵌套 —— 投票讨论区不需要那么重的结构。
 */

const MAX_LENGTH = 500
const LIST_LIMIT = 200

/**
 * 26 / 79 评论列表
 *
 * `reply_to_id` 存被回复评论的 id，展示时 JOIN 出作者昵称。
 * 原评论被删了 replyTo 就自然为空，不会显示「回复 undefined」。
 */
export async function listComments(
  db: D1Database,
  pollId: string,
  viewerId: string | null
) {
  await getPollRowOrThrow(db, pollId)
  const { results } = await db
    .prepare(
      `SELECT c.*,
              u.nickname AS user_name, u.avatar AS user_avatar,
              rc.id AS reply_id, rc.user_id AS reply_user_id, ru.nickname AS reply_name,
              (SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id = c.id AND l.user_id = ?) AS liked
       FROM comments c
       LEFT JOIN users u ON u.id = c.user_id
       LEFT JOIN comments rc ON rc.id = c.reply_to_id AND rc.deleted_at IS NULL
       LEFT JOIN users ru ON ru.id = rc.user_id
       WHERE c.poll_id = ? AND c.deleted_at IS NULL
       ORDER BY c.created_at DESC
       LIMIT ?`
    )
    .bind(viewerId ?? '', pollId, LIST_LIMIT)
    .all<{
      id: string
      poll_id: string
      user_id: string
      content: string
      reply_to_id: string | null
      like_count: number
      created_at: number
      user_name: string | null
      user_avatar: string | null
      reply_id: string | null
      reply_user_id: string | null
      reply_name: string | null
      liked: number
    }>()

  return results.map((row) => ({
    id: row.id,
    pollId: row.poll_id,
    content: row.content,
    createdAt: row.created_at,
    likeCount: row.like_count,
    liked: row.liked === 1,
    isMine: row.user_id === viewerId,
    user: {
      id: row.user_id,
      name: row.user_name ?? '',
      avatar: row.user_avatar ?? undefined
    },
    replyTo:
      row.reply_user_id && row.reply_name
        ? { id: row.reply_user_id, name: row.reply_name }
        : undefined
  }))
}

/** 发评论：`allow_comment` 关掉后直接拒绝，不靠前端藏输入框 */
export async function createComment(
  db: D1Database,
  pollId: string,
  userId: string,
  body: { content?: unknown; replyToId?: unknown },
  env?: Env
) {
  const row = await getPollRowOrThrow(db, pollId)
  if (!row.allow_comment) throw new HttpError(400, '发起人已关闭评论')

  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) throw new HttpError(400, '评论不能为空')
  if (content.length > MAX_LENGTH) throw new HttpError(400, `评论最多 ${MAX_LENGTH} 字`)

  const replyToId = typeof body.replyToId === 'string' ? body.replyToId : null
  let replyToUserId: string | null = null
  if (replyToId) {
    const parent = await db
      .prepare('SELECT id, user_id FROM comments WHERE id = ? AND poll_id = ? AND deleted_at IS NULL')
      .bind(replyToId, pollId)
      .first<{ id: string; user_id: string }>()
    if (!parent) throw new HttpError(404, '被回复的评论不存在')
    replyToUserId = parent.user_id
  }

  const id = newId('c')
  const now = Date.now()
  await db.batch([
    db
      .prepare(
        'INSERT INTO comments (id, poll_id, user_id, content, reply_to_id, like_count, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
      )
      .bind(id, pollId, userId, content, replyToId, now),
    db.prepare('UPDATE polls SET comment_count = comment_count + 1 WHERE id = ?').bind(pollId)
  ])

  await notifyComment(db, row, userId, content, replyToUserId, env)

  const { results } = await db
    .prepare(
      `SELECT c.*, u.nickname AS user_name, u.avatar AS user_avatar
       FROM comments c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.id = ?`
    )
    .bind(id)
    .all<{
      id: string
      poll_id: string
      user_id: string
      content: string
      reply_to_id: string | null
      like_count: number
      created_at: number
      user_name: string | null
      user_avatar: string | null
    }>()

  const created = results[0]
  let replyTo: { id: string; name: string } | undefined
  if (replyToId) {
    const parent = await db
      .prepare(
        `SELECT c.user_id, u.nickname AS user_name FROM comments c
         LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?`
      )
      .bind(replyToId)
      .first<{ user_id: string; user_name: string | null }>()
    if (parent) replyTo = { id: parent.user_id, name: parent.user_name ?? '' }
  }

  return {
    id: created.id,
    pollId: created.poll_id,
    content: created.content,
    createdAt: created.created_at,
    likeCount: created.like_count,
    liked: false,
    isMine: true,
    user: {
      id: created.user_id,
      name: created.user_name ?? '',
      avatar: created.user_avatar ?? undefined
    },
    replyTo
  }
}

/** 删除：作者本人或发起人可以删，软删除并回退 comment_count */
export async function deleteComment(
  db: D1Database,
  pollId: string,
  userId: string,
  commentId: string
) {
  const row = await getPollRowOrThrow(db, pollId)
  const comment = await db
    .prepare('SELECT id, user_id FROM comments WHERE id = ? AND poll_id = ? AND deleted_at IS NULL')
    .bind(commentId, pollId)
    .first<{ id: string; user_id: string }>()
  if (!comment) throw new HttpError(404, '评论不存在')
  if (comment.user_id !== userId && row.creator_id !== userId) {
    throw new HttpError(403, '只能删除自己的评论')
  }

  await db.batch([
    db
      .prepare('UPDATE comments SET deleted_at = ? WHERE id = ?')
      .bind(Date.now(), commentId),
    db
      .prepare(
        'UPDATE polls SET comment_count = MAX(comment_count - 1, 0) WHERE id = ?'
      )
      .bind(pollId)
  ])
}

/**
 * 点赞 / 取消点赞
 *
 * 用主键把重复点击挡在数据库层，再按 meta.changes 决定计数加不加，
 * 两个人同时点同一条也不会把 like_count 点重。
 */
export async function setCommentLike(
  db: D1Database,
  pollId: string,
  userId: string,
  commentId: string,
  liked: boolean
) {
  const comment = await db
    .prepare('SELECT id FROM comments WHERE id = ? AND poll_id = ? AND deleted_at IS NULL')
    .bind(commentId, pollId)
    .first<{ id: string }>()
  if (!comment) throw new HttpError(404, '评论不存在')

  if (liked) {
    const res = await db
      .prepare('INSERT OR IGNORE INTO comment_likes (comment_id, user_id, created_at) VALUES (?, ?, ?)')
      .bind(commentId, userId, Date.now())
      .run()
    if (res.meta.changes > 0) {
      await db
        .prepare('UPDATE comments SET like_count = like_count + 1 WHERE id = ?')
        .bind(commentId)
        .run()
    }
  } else {
    const res = await db
      .prepare('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?')
      .bind(commentId, userId)
      .run()
    if (res.meta.changes > 0) {
      await db
        .prepare('UPDATE comments SET like_count = MAX(like_count - 1, 0) WHERE id = ?')
        .bind(commentId)
        .run()
    }
  }

  const row = await db
    .prepare('SELECT like_count FROM comments WHERE id = ?')
    .bind(commentId)
    .first<{ like_count: number }>()
  return { liked, likeCount: row?.like_count ?? 0 }
}
