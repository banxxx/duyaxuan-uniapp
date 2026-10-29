import { Hono } from 'hono'
import type { AppEnv, PollStatusFilter } from '../types'
import { ok, HttpError } from '../lib/response'
import { optionalAuth, requireAuth } from '../middleware/auth'
import {
  bumpViewCount,
  createPoll,
  endPoll,
  getPoll,
  getPollRowOrThrow,
  listDiscover,
  listJoined,
  listMine,
  listPending,
  myStats,
  pollStats,
  pollVoters,
  restorePoll,
  searchPolls,
  softDeletePoll,
  updatePoll
} from '../db/polls'
import {
  assignAnswers,
  assertSummaryOwner,
  createOption,
  deleteOption,
  getOption,
  ignoreAnswers,
  listCandidates,
  listUnclassified,
  resetSummary,
  unassignAnswer,
  updateOption
} from '../db/summary'
import {
  createComment,
  deleteComment,
  listComments,
  setCommentLike
} from '../db/comments'
import { notifyPollEnded, remindMe } from '../db/notifications'
import { getPollQrcode } from '../db/qrcode'
import { acceptInvite, ensureInviteCode, isInviteOnly } from '../db/invites'
import { castVote, myVote, revokeVote } from '../db/votes'
import { listAnswers, myAnswers, submitAnswer, updateAnswer } from '../db/answers'

const polls = new Hono<AppEnv>()

// 详情 / 发现 / 搜索允许未登录浏览，登录了才带「我投过没」
polls.use('*', optionalAuth)

function statusQuery(raw: string | undefined): PollStatusFilter {
  return raw === 'ongoing' || raw === 'ended' ? raw : 'all'
}

function clientIp(c: { req: { header: (k: string) => string | undefined } }): string | null {
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')
  return ip ? ip.split(',')[0].trim() : null
}

/* ============================================================
 * 固定路径必须写在 /:id 前面，否则 "mine" 会被当成一个投票 id
 * ============================================================ */

/** 我发起的概览数字（首页顶部） */
polls.get('/stats', requireAuth, async (c) => {
  return ok(c, await myStats(c.env.DB, c.get('userId')!))
})

polls.get('/mine', requireAuth, async (c) => {
  const userId = c.get('userId')!
  return ok(
    c,
    await listMine(c.env.DB, userId, statusQuery(c.req.query('status')), c.req.query('cursor'))
  )
})

polls.get('/joined', requireAuth, async (c) => {
  const userId = c.get('userId')!
  return ok(
    c,
    await listJoined(c.env.DB, userId, statusQuery(c.req.query('status')), c.req.query('cursor'))
  )
})

polls.get('/pending', requireAuth, async (c) => {
  return ok(c, await listPending(c.env.DB, c.get('userId')!))
})

polls.get('/discover', async (c) => {
  return ok(
    c,
    await listDiscover(
      c.env.DB,
      c.get('userId'),
      statusQuery(c.req.query('status')),
      c.req.query('cursor')
    )
  )
})

polls.get('/search', async (c) => {
  const sort = c.req.query('sort') === 'hot' ? 'hot' : 'latest'
  return ok(c, await searchPolls(c.env.DB, c.get('userId'), c.req.query('keyword') ?? '', sort))
})

polls.post('/', requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}))
  return ok(c, await createPoll(c.env.DB, c.get('userId')!, body))
})

/* ============================================================
 * 单条投票
 * ============================================================ */

polls.get('/:id', async (c) => {
  const viewerId = c.get('userId')
  const poll = await getPoll(c.env.DB, c.req.param('id'), viewerId)
  // 浏览量统计失败不该影响用户看页面
  c.executionCtx.waitUntil(bumpViewCount(c.env.DB, poll.id).catch(() => {}))
  return ok(c, poll)
})

polls.put('/:id', requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}))
  return ok(c, await updatePoll(c.env.DB, c.req.param('id'), c.get('userId')!, body, c.env))
})

polls.delete('/:id', requireAuth, async (c) => {
  await softDeletePoll(c.env.DB, c.req.param('id'), c.get('userId')!)
  return ok(c, null)
})

polls.post('/:id/restore', requireAuth, async (c) => {
  await restorePoll(c.env.DB, c.req.param('id'), c.get('userId')!)
  return ok(c, null)
})

polls.post('/:id/end', requireAuth, async (c) => {
  const id = c.req.param('id')
  const changed = await endPoll(c.env.DB, id, c.get('userId')!)
  // 提前结束：立刻发结果通知，不用等用户下一次拉消息。
  // 已经结束过的投票不再重复通知。
  if (changed) {
    // 结束状态已经写入，通知失败不能把「结束投票」这个动作变成 500
    await notifyPollEnded(c.env.DB, await getPollRowOrThrow(c.env.DB, id), c.env).catch((err) =>
      console.error('[notify] poll ended failed', err)
    )
  }
  return ok(c, null)
})

/** 小程序码：给海报和分享页用，同一 poll 只生成一次 */
polls.get('/:id/qrcode', requireAuth, async (c) => {
  const row = await getPollRowOrThrow(c.env.DB, c.req.param('id'))
  const isOwner = row.creator_id === c.get('userId')
  // 关闭分享后，只有发起人自己还能取码
  if (!row.allow_share && !isOwner) {
    throw new HttpError(403, '发起人已关闭分享')
  }
  // 邀请制的码里带邀请码，等于把准入凭证放进了图片。
  // 只有发起人（分享的人）能取，否则任何登录用户拿 poll id 就能换出邀请码。
  if (isInviteOnly(row) && !isOwner) {
    throw new HttpError(403, '只有发起人可以生成邀请码')
  }
  const inviteCode = isInviteOnly(row) ? await ensureInviteCode(c.env.DB, row) : undefined
  return ok(c, { url: await getPollQrcode(c.env.DB, c.env.BUCKET, c.env, row.id, inviteCode) })
})

/**
 * 分享落地：记一条「谁带我来」的记录。
 * 邀请码模式必须带对码；链接模式带不带都行，带了就记来源。
 */
polls.post('/:id/join', requireAuth, async (c) => {
  const row = await getPollRowOrThrow(c.env.DB, c.req.param('id'))
  const body = (await c.req.json().catch(() => ({}))) as { code?: string }
  await acceptInvite(c.env.DB, row, c.get('userId')!, body.code)
  return ok(c, { joined: true })
})

/** 邀请码：只有发起人拿得到，分享页展示、分享链接带上 */
polls.get('/:id/invite-code', requireAuth, async (c) => {
  const row = await getPollRowOrThrow(c.env.DB, c.req.param('id'))
  if (row.creator_id !== c.get('userId')) {
    throw new HttpError(403, '只有发起人可以查看邀请码')
  }
  return ok(c, { code: await ensureInviteCode(c.env.DB, row) })
})

/** 提醒我：记一条提醒，截止后第一次拉通知列表时补发 */
polls.post('/:id/remind', requireAuth, async (c) => {
  const row = await getPollRowOrThrow(c.env.DB, c.req.param('id'))
  await remindMe(c.env.DB, row, c.get('userId')!)
  return ok(c, null)
})

/* ---------------- 投票 ---------------- */

polls.post('/:id/vote', requireAuth, async (c) => {
  const userId = c.get('userId')!
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as {
    optionIds?: string[]
    profileInfo?: string
  }
  if (!Array.isArray(body.optionIds)) throw new HttpError(400, '请选择选项')

  const row = await getPollRowOrThrow(c.env.DB, id)
  await castVote(c.env.DB, row, userId, body.optionIds, body.profileInfo, clientIp(c), c.env)
  return ok(c, await getPoll(c.env.DB, id, userId))
})

polls.delete('/:id/vote', requireAuth, async (c) => {
  const userId = c.get('userId')!
  const id = c.req.param('id')
  const row = await getPollRowOrThrow(c.env.DB, id)
  await revokeVote(c.env.DB, row, userId)
  return ok(c, await getPoll(c.env.DB, id, userId))
})

polls.get('/:id/my-vote', requireAuth, async (c) => {
  const id = c.req.param('id')
  await getPollRowOrThrow(c.env.DB, id)
  return ok(c, await myVote(c.env.DB, id, c.get('userId')!))
})

/* ---------------- 评论 ---------------- */

polls.get('/:id/comments', async (c) => {
  return ok(c, await listComments(c.env.DB, c.req.param('id'), c.get('userId')))
})

polls.post('/:id/comments', requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}))
  return ok(c, await createComment(c.env.DB, c.req.param('id'), c.get('userId')!, body, c.env))
})

polls.delete('/:id/comments/:commentId', requireAuth, async (c) => {
  await deleteComment(c.env.DB, c.req.param('id'), c.get('userId')!, c.req.param('commentId'))
  return ok(c, null)
})

polls.post('/:id/comments/:commentId/like', requireAuth, async (c) => {
  return ok(
    c,
    await setCommentLike(c.env.DB, c.req.param('id'), c.get('userId')!, c.req.param('commentId'), true)
  )
})

polls.delete('/:id/comments/:commentId/like', requireAuth, async (c) => {
  return ok(
    c,
    await setCommentLike(c.env.DB, c.req.param('id'), c.get('userId')!, c.req.param('commentId'), false)
  )
})

/* ---------------- 问卷回答 ---------------- */

polls.get('/:id/answers', async (c) => {
  const id = c.req.param('id')
  const row = await getPollRowOrThrow(c.env.DB, id)
  if (row.type !== 'survey') throw new HttpError(400, '这不是问卷')
  return ok(c, await listAnswers(c.env.DB, row, c.get('userId'), c.req.query('cursor')))
})

polls.post('/:id/answers', requireAuth, async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as {
    content?: string
    profileInfo?: string
  }
  const row = await getPollRowOrThrow(c.env.DB, id)
  return ok(
    c,
    await submitAnswer(
      c.env.DB,
      row,
      c.get('userId')!,
      body.content ?? '',
      body.profileInfo,
      clientIp(c),
      c.env
    )
  )
})

polls.get('/:id/my-answers', requireAuth, async (c) => {
  const id = c.req.param('id')
  await getPollRowOrThrow(c.env.DB, id)
  return ok(c, await myAnswers(c.env.DB, id, c.get('userId')!))
})

polls.put('/:id/answers/:answerId', requireAuth, async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { content?: string }
  const row = await getPollRowOrThrow(c.env.DB, id)
  return ok(
    c,
    await updateAnswer(c.env.DB, row, c.get('userId')!, c.req.param('answerId'), body.content ?? '')
  )
})

/* ---------------- 数据页 ---------------- */

polls.get('/:id/voters', async (c) => {
  return ok(
    c,
    await pollVoters(c.env.DB, c.req.param('id'), c.get('userId'), c.req.query('cursor'))
  )
})

polls.get('/:id/stats', requireAuth, async (c) => {
  const row = await getPollRowOrThrow(c.env.DB, c.req.param('id'))
  if (row.creator_id !== c.get('userId')) {
    throw new HttpError(403, '只有发起人可以查看数据')
  }
  return ok(c, await pollStats(c.env.DB, c.req.param('id')))
})

/* ---------------- 汇总（问卷 → 投票） ----------------
 *
 * 回答里有参与者写的内容，不能像投票详情那样公开，
 * 读和写都要求「登录 + 是这份问卷的发起人」。
 */

polls.get('/:id/summary/candidates', requireAuth, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  await assertSummaryOwner(DB, id, c.get('userId')!)
  return ok(c, await listCandidates(DB, id))
})

polls.get('/:id/summary/unclassified', requireAuth, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  await assertSummaryOwner(DB, id, c.get('userId')!)
  return ok(c, await listUnclassified(DB, id))
})

/** 编辑选项页：拿选项本身 + 归在它下面的回答 */
polls.get('/:id/summary/options/:optionId', requireAuth, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  await assertSummaryOwner(DB, id, c.get('userId')!)
  return ok(c, await getOption(DB, id, c.req.param('optionId')))
})

/** 新建候选选项，可顺手把选中的回答归进去 */
polls.post('/:id/summary/options', requireAuth, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  await assertSummaryOwner(DB, id, c.get('userId')!)
  const body = await c.req.json().catch(() => ({}))
  return ok(c, await createOption(DB, id, body))
})

polls.put('/:id/summary/options/:optionId', requireAuth, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  await assertSummaryOwner(DB, id, c.get('userId')!)
  const body = await c.req.json().catch(() => ({}))
  await updateOption(DB, id, c.req.param('optionId'), body)
  return ok(c, null)
})

polls.delete('/:id/summary/options/:optionId', requireAuth, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  await assertSummaryOwner(DB, id, c.get('userId')!)
  await deleteOption(DB, id, c.req.param('optionId'))
  return ok(c, null)
})

/** 归入已有选项 */
polls.post('/:id/summary/options/:optionId/answers', requireAuth, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  await assertSummaryOwner(DB, id, c.get('userId')!)
  const body = (await c.req.json().catch(() => ({}))) as { answerIds?: unknown }
  await assignAnswers(DB, id, c.req.param('optionId'), body.answerIds)
  return ok(c, null)
})

/** 移出：回到未归类 */
polls.delete('/:id/summary/options/:optionId/answers/:answerId', requireAuth, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  await assertSummaryOwner(DB, id, c.get('userId')!)
  await unassignAnswer(DB, id, c.req.param('optionId'), c.req.param('answerId'))
  return ok(c, null)
})

/** 忽略：不进汇总，原文仍在问卷数据里 */
polls.post('/:id/summary/ignore', requireAuth, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  await assertSummaryOwner(DB, id, c.get('userId')!)
  const body = (await c.req.json().catch(() => ({}))) as { answerIds?: unknown }
  return ok(c, { ignored: await ignoreAnswers(DB, id, body.answerIds) })
})

/** 重新归并：清掉整理结果，按原文重新分组（手动的调整会丢，前端要二次确认） */
polls.post('/:id/summary/remerge', requireAuth, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  await assertSummaryOwner(DB, id, c.get('userId')!)
  await resetSummary(DB, id)
  return ok(c, null)
})

export default polls
