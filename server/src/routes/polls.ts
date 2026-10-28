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
  summaryGroups,
  updatePoll
} from '../db/polls'
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
  return ok(c, await searchPolls(c.env.DB, c.get('userId'), c.req.query('keyword') ?? ''))
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
  return ok(c, await updatePoll(c.env.DB, c.req.param('id'), c.get('userId')!, body))
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
  await endPoll(c.env.DB, c.req.param('id'), c.get('userId')!)
  return ok(c, null)
})

/** 提醒我：通知功能还没做，先收下请求别报错 */
polls.post('/:id/remind', requireAuth, async (c) => {
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
  await castVote(c.env.DB, row, userId, body.optionIds, body.profileInfo, clientIp(c))
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
  return ok(c, await myVote(c.env.DB, c.req.param('id'), c.get('userId')!))
})

/* ---------------- 评论（暂未实现，先返回空数组） ---------------- */

polls.get('/:id/comments', async (c) => {
  // 详情页会拉评论列表，返回 404 会让页面弹「请求失败」。功能没做之前返回空数组。
  return ok(c, [])
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
  return ok(c, await submitAnswer(c.env.DB, row, c.get('userId')!, body.content ?? '', body.profileInfo))
})

polls.get('/:id/my-answers', requireAuth, async (c) => {
  return ok(c, await myAnswers(c.env.DB, c.req.param('id'), c.get('userId')!))
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
  return ok(c, await pollVoters(c.env.DB, c.req.param('id'), c.get('userId')))
})

polls.get('/:id/stats', async (c) => {
  return ok(c, await pollStats(c.env.DB, c.req.param('id')))
})

polls.get('/:id/summary/candidates', async (c) => {
  const { candidates } = await summaryGroups(c.env.DB, c.req.param('id'))
  return ok(c, candidates)
})

polls.get('/:id/summary/unclassified', async (c) => {
  const { unclassified } = await summaryGroups(c.env.DB, c.req.param('id'))
  return ok(c, unclassified)
})

export default polls
