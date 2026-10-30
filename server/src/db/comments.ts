import { newId } from '../lib/id'
import { HttpError } from '../lib/response'
import type { Env } from '../types'
import { notifyComment } from './notifications'
import { getPollRowOrThrow } from './polls'
import { assertCanJoin, isInviteOnly } from './invites'

/**
 * 评论区
 *
 * 链接模式的投票评论公开可读（详情页未登录也能看讨论）；
 * 邀请码模式的评论只对发起人和参与者开放。
 * 发评论 / 点赞 / 删除始终要求登录。
 *
 * 楼层只做一级：回复某条评论时把 reply_to_id 存下来，展示成「回复 xx：」，
 * 不做无限嵌套 —— 投票讨论区不需要那么重的结构。
 */

const MAX_LENGTH = 500
const LIST_PAGE = 50

/**
 * 游标编码。
 *
 * 最新排序是 `created_at:id`；最热排序多一个 like_count 做主键。
 * 只用 created_at 会在同一毫秒两条评论时互相挤掉，所以都要带上 id 做最后一层。
 */
function encodeLatestCursor(createdAt: number, id: string): string {
  return `${createdAt}:${id}`
}

function encodeHotCursor(likeCount: number, createdAt: number, id: string): string {
  return `${likeCount}:${createdAt}:${id}`
}

function decodeLatestCursor(cursor: string | null | undefined): { at: number; id: string } | null {
  if (!cursor) return null
  const i = cursor.indexOf(':')
  if (i <= 0) return null
  const at = Number(cursor.slice(0, i))
  const id = cursor.slice(i + 1)
  if (!Number.isFinite(at) || !id) return null
  return { at, id }
}

function decodeHotCursor(
  cursor: string | null | undefined
): { likes: number; at: number; id: string } | null {
  if (!cursor) return null
  const parts = cursor.split(':')
  if (parts.length !== 3) return null
  const likes = Number(parts[0])
  const at = Number(parts[1])
  if (!Number.isFinite(likes) || !Number.isFinite(at) || !parts[2]) return null
  return { likes, at, id: parts[2] }
}

interface CommentRow {
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
}

function toComment(row: CommentRow, viewerId: string | null) {
  return {
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
    // 前端要靠它把回复挂到对应楼层下（replyTo 只有「回复的是谁」，没有「挂在哪条」）
    replyToId: row.reply_to_id ?? undefined,
    replyTo:
      row.reply_user_id && row.reply_name
        ? { id: row.reply_user_id, name: row.reply_name }
        : undefined
  }
}

/**
 * 26 / 79 评论列表（分页）
 *
 * `reply_to_id` 存被回复评论的 id，展示时 JOIN 出作者昵称。
 * 原评论被删了 replyTo 就自然为空，不会显示「回复 undefined」。
 *
 * 以前写死 LIMIT 200，讨论区页面没有「加载更多」，超过 200 条就再也看不到。
 * 现在按游标分页：讨论区在翻页的同时可能有人发新评论，offset 会让新评论把
 * 后面的内容往前挤、跳过一条，游标则始终从「上次看到的位置」继续。
 *
 * sort=latest 按时间倒序；sort=hot 按点赞数倒序（赞数相同时按时间倒序）。
 */
export async function listComments(
  db: D1Database,
  pollId: string,
  viewerId: string | null,
  cursor?: string | null,
  sort: 'latest' | 'hot' = 'latest'
): Promise<{ list: ReturnType<typeof toComment>[]; cursor: string | null; hasMore: boolean; total: number }> {
  const row = await getPollRowOrThrow(db, pollId)
  // 详情页本身可以公开预览，但邀请制投票的评论正文不能靠知道 poll id 读到
  if (isInviteOnly(row)) {
    if (!viewerId) throw new HttpError(403, '需要邀请码才能参与')
    await assertCanJoin(db, row, viewerId)
  }

  const totalRow = await db
    .prepare('SELECT COUNT(*) AS n FROM comments WHERE poll_id = ? AND deleted_at IS NULL')
    .bind(pollId)
    .first<{ n: number }>()
  const total = totalRow?.n ?? 0

  let where: string
  let binds: Array<string | number>
  let order: string

  if (sort === 'hot') {
    const after = decodeHotCursor(cursor)
    where = after
      ? 'AND (c.like_count < ? OR (c.like_count = ? AND c.created_at < ?) OR (c.like_count = ? AND c.created_at = ? AND c.id < ?))'
      : ''
    binds = after
      ? [viewerId ?? '', pollId, after.likes, after.likes, after.at, after.likes, after.at, after.id, LIST_PAGE + 1]
      : [viewerId ?? '', pollId, LIST_PAGE + 1]
    order = 'c.like_count DESC, c.created_at DESC, c.id DESC'
  } else {
    const after = decodeLatestCursor(cursor)
    where = after ? 'AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))' : ''
    binds = after
      ? [viewerId ?? '', pollId, after.at, after.at, after.id, LIST_PAGE + 1]
      : [viewerId ?? '', pollId, LIST_PAGE + 1]
    order = 'c.created_at DESC, c.id DESC'
  }

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
       WHERE c.poll_id = ? AND c.deleted_at IS NULL ${where}
       ORDER BY ${order}
       LIMIT ?`
    )
    .bind(...binds)
    .all<CommentRow>()

  const hasMore = results.length > LIST_PAGE
  const page = hasMore ? results.slice(0, LIST_PAGE) : results
  const list = page.map((r) => toComment(r, viewerId))
  const last = page[page.length - 1]
  const nextCursor = !hasMore || !last
    ? null
    : sort === 'hot'
      ? encodeHotCursor(last.like_count, last.created_at, last.id)
      : encodeLatestCursor(last.created_at, last.id)
  return { list, cursor: nextCursor, hasMore, total }
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
  // 邀请制投票的讨论区也只对参与者开放，不能绕过投票直接进来留言
  await assertCanJoin(db, row, userId)

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

  // 评论已经落库，通知失败不能让用户看到「评论失败」再重发一条
  await notifyComment(db, row, userId, content, replyToUserId, env).catch((err) =>
    console.error('[notify] comment failed', err)
  )

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
    replyToId: created.reply_to_id ?? undefined,
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
  const pollRow = await getPollRowOrThrow(db, pollId)
  // 和发评论一致：邀请制投票的互动也只对参与者开放
  await assertCanJoin(db, pollRow, userId)
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
