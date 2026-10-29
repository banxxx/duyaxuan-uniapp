import type {
  Poll,
  Paged,
  Comment,
  SurveyAnswer,
  SummaryCandidate,
  UnclassifiedAnswer,
  SummaryOptionDetail,
  VoterRecord
} from '@/types/api'
import { http } from '@/utils/request'
import { resolveFileUrl } from '@/utils/api-base'
import { useMock } from '@/utils/env'
import {
  mockPolls,
  mockComments,
  mockAnswers,
  mockStats,
  mockMyVotes,
  mockMyAnswers,
  mockVoters,
  mockPollStats,
  mockCandidates,
  mockUnclassified,
  mockPending
} from '@/mock/data'
import type { PendingPoll } from '@/mock/data'

/**
 * 投票 / 问卷接口
 *
 * USE_MOCK 打开时走本地假数据（与设计稿同一份数据），关掉后同一批函数
 * 直接打到后端 —— 页面层不需要改任何一行。
 */
const USE_MOCK = useMock()

const delay = (ms = 180) => new Promise((r) => setTimeout(r, ms))

/** mock：记录我填过的「需个人信息」，真实后端由 votes/answers 表保存 */
const mockMyProfileInfo: Record<string, string> = {}

function paginate<T>(list: T[], cursor?: string | null, size = 20): Paged<T> {
  const start = cursor ? Number(cursor) : 0
  const slice = list.slice(start, start + size)
  const next = start + size
  return {
    list: slice,
    cursor: next < list.length ? String(next) : null,
    hasMore: next < list.length,
    total: list.length
  }
}

export async function fetchMyPolls(
  status: 'all' | 'ongoing' | 'ended' = 'all',
  cursor?: string | null
): Promise<Paged<Poll>> {
  if (USE_MOCK) {
    await delay()
    const list = mockPolls
      .filter((p) => p.creatorId === '1024')
      .filter((p) => {
        if (status === 'all') return true
        const ended = p.rules.endAt <= Date.now()
        return status === 'ended' ? ended : !ended
      })
    return paginate(list, cursor)
  }
  return http.get<Paged<Poll>>('/polls/mine', { status, cursor })
}

export async function fetchJoinedPolls(
  status: 'all' | 'ongoing' | 'ended' = 'all',
  cursor?: string | null
): Promise<Paged<Poll>> {
  if (USE_MOCK) {
    await delay()
    const list = mockPolls
      .filter((p) => p.creatorId !== '1024')
      .filter((p) => {
        if (status === 'all') return true
        const ended = p.rules.endAt <= Date.now()
        return status === 'ended' ? ended : !ended
      })
      // 问卷列表行要显示「已回答 / 待填写」，后端在列表接口里一并给出
      .map((p) =>
        p.type === 'survey'
          ? { ...p, myAnswered: (mockMyAnswers[p.id]?.length ?? 0) > 0 }
          : p
      )
    return paginate(list, cursor)
  }
  return http.get<Paged<Poll>>('/polls/joined', { status, cursor })
}

/** 02 首页 · 待我投票：别人邀请我、我还没投的，按截止时间由近到远 */
export async function fetchPendingPolls(): Promise<PendingPoll[]> {
  if (USE_MOCK) {
    await delay(200)
    return mockPending
  }
  return http.get<PendingPoll[]>('/polls/pending')
}

export async function fetchDiscoverPolls(
  status: 'all' | 'ongoing' | 'ended' = 'all',
  cursor?: string | null
): Promise<Paged<Poll>> {
  if (USE_MOCK) {
    await delay()
    return paginate(mockPolls, cursor)
  }
  return http.get<Paged<Poll>>('/polls/discover', { status, cursor })
}

export async function searchPolls(
  keyword: string,
  sort: 'latest' | 'hot' = 'latest'
): Promise<Poll[]> {
  if (USE_MOCK) {
    await delay()
    if (!keyword.trim()) return []
    const k = keyword.trim()
    const hit = mockPolls.filter((p) => p.title.includes(k) || (p.desc ?? '').includes(k))
    return sort === 'hot' ? [...hit].sort((a, b) => b.voterCount - a.voterCount) : hit
  }
  return http.get<Poll[]>('/polls/search', { keyword, sort })
}

export async function fetchPoll(id: string): Promise<Poll> {
  if (USE_MOCK) {
    await delay()
    const hit = mockPolls.find((p) => p.id === id)
    if (!hit) throw new Error('投票不存在')
    return JSON.parse(JSON.stringify(hit))
  }
  return http.get<Poll>(`/polls/${id}`)
}

export async function fetchStats(): Promise<Array<{ value: string | number; label: string }>> {
  if (USE_MOCK) {
    await delay(80)
    return mockStats()
  }
  return http.get<Array<{ value: string | number; label: string }>>('/polls/stats')
}

export async function votePoll(
  pollId: string,
  optionIds: string[],
  profileInfo?: string,
  /** toast:false 时不弹默认错误，调用方自己处理（比如邀请码弹窗） */
  opts?: { toast?: boolean }
): Promise<Poll> {
  if (USE_MOCK) {
    await delay(300)
    const poll = mockPolls.find((p) => p.id === pollId)
    if (!poll) throw new Error('投票不存在')
    poll.options.forEach((o) => {
      if (optionIds.includes(o.id)) o.votes += 1
    })
    poll.voterCount += 1
    mockMyVotes[pollId] = [...optionIds]
    if (profileInfo) mockMyProfileInfo[pollId] = profileInfo
    return JSON.parse(JSON.stringify(poll))
  }
  return http.post<Poll>(`/polls/${pollId}/vote`, { optionIds, profileInfo }, opts)
}

/** 撤回我这一票（仅在「允许修改选择」且未截止时可用） */
export async function revokeVote(pollId: string): Promise<Poll> {
  if (USE_MOCK) {
    await delay(250)
    const poll = mockPolls.find((p) => p.id === pollId)
    if (!poll) throw new Error('投票不存在')
    const mine = mockMyVotes[pollId] ?? []
    poll.options.forEach((o) => {
      if (mine.includes(o.id)) o.votes = Math.max(0, o.votes - 1)
    })
    poll.voterCount = Math.max(0, poll.voterCount - 1)
    delete mockMyVotes[pollId]
    return JSON.parse(JSON.stringify(poll))
  }
  return http.del<Poll>(`/polls/${pollId}/vote`)
}

/** 我在这条投票里的选择；没投过返回空数组 */
export async function fetchMyVote(pollId: string): Promise<string[]> {
  if (USE_MOCK) {
    await delay(80)
    return [...(mockMyVotes[pollId] ?? [])]
  }
  return http.get<string[]>(`/polls/${pollId}/my-vote`)
}

/** 创建投票 / 问卷：body 直接就是 draft 的形状，服务端自己拆表 */
export async function createPoll(body: Record<string, any>): Promise<Poll> {
  if (USE_MOCK) {
    await delay(320)
    const draftOptions = (body.options ?? []) as Array<{ title: string; desc?: string }>
    const poll: Poll = {
      id: `p_${Date.now()}`,
      type: body.type,
      title: body.title,
      desc: body.desc || undefined,
      creatorId: '1024',
      creatorName: '林小满',
      createdAt: Date.now(),
      rules: body.rules,
      options:
        body.type === 'survey'
          ? []
          : draftOptions.map((o, i) => ({
              id: `o${i + 1}`,
              title: o.title,
              desc: o.desc,
              votes: 0
            })),
      voterCount: 0,
      answerCount: body.type === 'survey' ? 0 : undefined,
      commentCount: 0,
      viewCount: 0,
      sourceSurveyId: body.sourceSurveyId
    }
    mockPolls.unshift(poll)
    return JSON.parse(JSON.stringify(poll))
  }
  return http.post<Poll>('/polls', body)
}

/** 编辑已发布的投票 / 问卷 */
export async function updatePoll(id: string, body: Record<string, any>): Promise<Poll> {
  if (USE_MOCK) {
    await delay(320)
    const hit = mockPolls.find((p) => p.id === id)
    if (!hit) throw new Error('投票不存在')
    hit.title = body.title
    hit.desc = body.desc || undefined
    hit.rules = body.rules
    if (body.type !== 'survey' && Array.isArray(body.options)) {
      hit.options = body.options.map((o: any, i: number) => ({
        id: o.id ?? `o_new_${i}`,
        title: o.title,
        desc: o.desc,
        votes: o.votes ?? 0
      }))
    }
    return JSON.parse(JSON.stringify(hit))
  }
  return http.put<Poll>(`/polls/${id}`, body)
}

export async function deletePoll(id: string): Promise<void> {
  if (USE_MOCK) {
    await delay(200)
    const i = mockPolls.findIndex((p) => p.id === id)
    if (i >= 0) mockPolls.splice(i, 1)
    return
  }
  return http.del<void>(`/polls/${id}`)
}

export async function restorePoll(id: string): Promise<void> {
  if (USE_MOCK) {
    await delay(200)
    return
  }
  return http.post<void>(`/polls/${id}/restore`)
}

export async function fetchComments(
  pollId: string,
  opts?: { toast?: boolean }
): Promise<Comment[]> {
  if (USE_MOCK) {
    await delay()
    return mockComments.filter((c) => c.pollId === pollId)
  }
  return http.get<Comment[]>(`/polls/${pollId}/comments`, undefined, opts)
}

/** 发评论；replyToId 是「回复」的目标评论 */
export async function createComment(
  pollId: string,
  content: string,
  replyToId?: string
): Promise<Comment> {
  if (USE_MOCK) {
    await delay(200)
    const parent = replyToId ? mockComments.find((c) => c.id === replyToId) : undefined
    const comment: Comment = {
      id: `c${Date.now()}`,
      pollId,
      content,
      createdAt: Date.now(),
      likeCount: 0,
      liked: false,
      isMine: true,
      user: { id: '1024', name: '我' },
      replyToId,
      replyTo: parent ? { id: parent.user.id, name: parent.user.name } : undefined
    }
    mockComments.unshift(comment)
    const poll = mockPolls.find((p) => p.id === pollId)
    if (poll) poll.commentCount = (poll.commentCount ?? 0) + 1
    return { ...comment }
  }
  return http.post<Comment>(`/polls/${pollId}/comments`, { content, replyToId })
}

export async function deleteComment(pollId: string, commentId: string): Promise<void> {
  if (USE_MOCK) {
    await delay(160)
    const i = mockComments.findIndex((c) => c.id === commentId)
    if (i >= 0) mockComments.splice(i, 1)
    return
  }
  return http.del<void>(`/polls/${pollId}/comments/${commentId}`)
}

/** 点赞 / 取消点赞，返回最新计数 */
export async function setCommentLike(
  pollId: string,
  commentId: string,
  liked: boolean
): Promise<{ liked: boolean; likeCount: number }> {
  if (USE_MOCK) {
    await delay(140)
    const hit = mockComments.find((c) => c.id === commentId)
    if (!hit) throw new Error('评论不存在')
    if (liked && !hit.liked) hit.likeCount += 1
    if (!liked && hit.liked) hit.likeCount = Math.max(0, hit.likeCount - 1)
    hit.liked = liked
    return { liked, likeCount: hit.likeCount }
  }
  const url = `/polls/${pollId}/comments/${commentId}/like`
  return liked
    ? http.post<{ liked: boolean; likeCount: number }>(url)
    : http.del<{ liked: boolean; likeCount: number }>(url)
}

export async function fetchAnswers(
  pollId: string,
  cursor?: string | null,
  opts?: { toast?: boolean }
): Promise<Paged<SurveyAnswer>> {
  if (USE_MOCK) {
    await delay()
    return paginate(
      mockAnswers.filter((a) => a.pollId === pollId),
      cursor
    )
  }
  return http.get<Paged<SurveyAnswer>>(`/polls/${pollId}/answers`, { cursor }, opts)
}

export async function submitAnswer(
  pollId: string,
  content: string,
  profileInfo?: string,
  /** toast:false 时不弹默认错误，调用方自己处理 */
  opts?: { toast?: boolean }
): Promise<SurveyAnswer> {
  if (USE_MOCK) {
    await delay(300)
    const answer: SurveyAnswer = {
      id: `a${Date.now()}`,
      pollId,
      content,
      createdAt: Date.now(),
      profileInfo
    }
    mockAnswers.unshift(answer)
    mockMyAnswers[pollId] = [...(mockMyAnswers[pollId] ?? []), answer.id]
    const poll = mockPolls.find((p) => p.id === pollId)
    if (poll) poll.answerCount = (poll.answerCount ?? 0) + 1
    return answer
  }
  return http.post<SurveyAnswer>(`/polls/${pollId}/answers`, { content, profileInfo }, opts)
}

/** 我在这份问卷里提交过的回答，按时间倒序（71 我的提交记录） */
export async function fetchMyAnswers(pollId: string): Promise<SurveyAnswer[]> {
  if (USE_MOCK) {
    await delay(150)
    const ids = mockMyAnswers[pollId] ?? []
    return mockAnswers.filter((a) => a.pollId === pollId && ids.includes(a.id))
  }
  return http.get<SurveyAnswer[]>(`/polls/${pollId}/my-answers`)
}

/** 修改一条已有回答（覆盖，总数不变） */
export async function updateAnswer(pollId: string, answerId: string, content: string): Promise<SurveyAnswer> {
  if (USE_MOCK) {
    await delay(260)
    const hit = mockAnswers.find((a) => a.id === answerId)
    if (!hit) throw new Error('回答不存在')
    hit.content = content
    hit.updatedAt = Date.now()
    return { ...hit }
  }
  return http.put<SurveyAnswer>(`/polls/${pollId}/answers/${answerId}`, { content })
}

/** 14/15 投票记录 */
export async function fetchVoters(
  pollId: string,
  cursor?: string | null
): Promise<Paged<VoterRecord>> {
  if (USE_MOCK) {
    await delay(200)
    const list = mockVoters(pollId)
    return { list, cursor: null, hasMore: false, total: list.length }
  }
  return http.get<Paged<VoterRecord>>(`/polls/${pollId}/voters`, { cursor })
}

/**
 * 27/80 分享页的小程序码
 *
 * 后端生成一次就缓存在 R2，重复请求不会反复调微信接口。
 * 返回的是 `/files/qrcodes/...` 相对地址，这里补全成完整 URL。
 */
/** 分享落地：记录「谁带我来」。邀请码不对时后端返回 403，调用方自己提示 */
export async function joinPoll(pollId: string, code?: string): Promise<void> {
  if (USE_MOCK) return
  await http.post<{ joined: boolean }>(
    `/polls/${pollId}/join`,
    code ? { code } : {},
    { toast: false }
  )
}

/** 邀请码：只有发起人拿得到，分享页展示用 */
export async function fetchInviteCode(pollId: string): Promise<string> {
  if (USE_MOCK) return ''
  const res = await http.get<{ code: string }>(`/polls/${pollId}/invite-code`, undefined, {
    toast: false
  })
  return res.code
}

export async function fetchPollQrcode(pollId: string): Promise<string> {
  if (USE_MOCK) {
    await delay(120)
    return ''
  }
  const res = await http.get<{ url: string }>(`/polls/${pollId}/qrcode`, undefined, { toast: false })
  return resolveFileUrl(res.url)
}

/** 24/25 发布者数据 */
export async function fetchPollStats(pollId: string) {
  if (USE_MOCK) {
    await delay(200)
    return mockPollStats(pollId)
  }
  return http.get<ReturnType<typeof mockPollStats>>(`/polls/${pollId}/stats`)
}

/** 84 汇总候选选项 */
export async function fetchSummaryCandidates(pollId: string): Promise<SummaryCandidate[]> {
  if (USE_MOCK) {
    await delay(200)
    return mockCandidates
  }
  return http.get<SummaryCandidate[]>(`/polls/${pollId}/summary/candidates`)
}

/** 86 未归类回答 */
export async function fetchUnclassified(pollId: string): Promise<UnclassifiedAnswer[]> {
  if (USE_MOCK) {
    await delay(150)
    return mockUnclassified
  }
  return http.get<UnclassifiedAnswer[]>(`/polls/${pollId}/summary/unclassified`)
}

/** 85 编辑选项：候选选项本身 + 归在它下面的回答明细 */
export async function fetchSummaryOption(
  pollId: string,
  optionId: string
): Promise<SummaryOptionDetail> {
  if (USE_MOCK) {
    await delay()
    const hit = mockCandidates.find((c) => c.id === optionId) ?? mockCandidates[0]
    return {
      ...hit,
      answers: mockAnswers.slice(0, 3).map((a) => ({
        id: a.id,
        createdAt: a.createdAt,
        content: a.content
      }))
    }
  }
  return http.get<SummaryOptionDetail>(`/polls/${pollId}/summary/options/${optionId}`)
}

async function summaryWrite<T>(fn: () => Promise<T>): Promise<T> {
  if (USE_MOCK) {
    await delay(200)
    return undefined as T
  }
  return fn()
}

/** 85 保存标题/说明 */
export function updateSummaryOption(
  pollId: string,
  optionId: string,
  patch: { title: string; desc: string }
): Promise<void> {
  return summaryWrite(() =>
    http.put<void>(`/polls/${pollId}/summary/options/${optionId}`, patch)
  )
}

/** 85 删除候选选项：下面的回答回到未归类 */
export function deleteSummaryOption(pollId: string, optionId: string): Promise<void> {
  return summaryWrite(() => http.del<void>(`/polls/${pollId}/summary/options/${optionId}`))
}

/** 86 用一条回答新建选项 */
export function createSummaryOption(
  pollId: string,
  body: { title: string; desc?: string; answerIds?: string[] }
): Promise<{ id: string }> {
  return summaryWrite(() => http.post<{ id: string }>(`/polls/${pollId}/summary/options`, body))
}

/** 86 归入已有选项 */
export function assignSummaryAnswers(
  pollId: string,
  optionId: string,
  answerIds: string[]
): Promise<void> {
  return summaryWrite(() =>
    http.post<void>(`/polls/${pollId}/summary/options/${optionId}/answers`, { answerIds })
  )
}

/** 85 把一条回答移出选项，回到未归类 */
export function unassignSummaryAnswer(
  pollId: string,
  optionId: string,
  answerId: string
): Promise<void> {
  return summaryWrite(() =>
    http.del<void>(`/polls/${pollId}/summary/options/${optionId}/answers/${answerId}`)
  )
}

/** 86 忽略：不进汇总，原文仍留在问卷数据里 */
export function ignoreSummaryAnswers(pollId: string, answerIds: string[]): Promise<{ ignored: number }> {
  return summaryWrite(() =>
    http.post<{ ignored: number }>(`/polls/${pollId}/summary/ignore`, { answerIds })
  )
}

/** 84 重新归并：清掉整理结果后按原文重新分组 */
export function remergeSummary(pollId: string): Promise<void> {
  return summaryWrite(() => http.post<void>(`/polls/${pollId}/summary/remerge`))
}

/** 提前结束投票 */
export async function endPoll(pollId: string): Promise<void> {
  if (USE_MOCK) {
    await delay(250)
    const poll = mockPolls.find((p) => p.id === pollId)
    if (poll) poll.rules.endAt = Date.now()
    return
  }
  return http.post<void>(`/polls/${pollId}/end`)
}

/** 收藏 / 提醒：截止时提醒我（22 结果 · 待公布） */
export async function remindMe(pollId: string): Promise<void> {
  if (USE_MOCK) {
    await delay(120)
    return
  }
  return http.post<void>(`/polls/${pollId}/remind`)
}
