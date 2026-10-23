import type { Poll, Paged, Comment, SurveyAnswer } from '@/types/api'
import { http } from '@/utils/request'
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
import type { SummaryCandidate, UnclassifiedAnswer, PendingPoll } from '@/mock/data'

/**
 * 投票 / 问卷接口
 *
 * USE_MOCK 打开时走本地假数据（与设计稿同一份数据），关掉后同一批函数
 * 直接打到后端 —— 页面层不需要改任何一行。
 */
const USE_MOCK = useMock()

const delay = (ms = 180) => new Promise((r) => setTimeout(r, ms))

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

export async function searchPolls(keyword: string): Promise<Poll[]> {
  if (USE_MOCK) {
    await delay()
    if (!keyword.trim()) return []
    const k = keyword.trim()
    return mockPolls.filter((p) => p.title.includes(k) || (p.desc ?? '').includes(k))
  }
  return http.get<Poll[]>('/polls/search', { keyword })
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

export async function votePoll(pollId: string, optionIds: string[]): Promise<Poll> {
  if (USE_MOCK) {
    await delay(300)
    const poll = mockPolls.find((p) => p.id === pollId)
    if (!poll) throw new Error('投票不存在')
    poll.options.forEach((o) => {
      if (optionIds.includes(o.id)) o.votes += 1
    })
    poll.voterCount += 1
    mockMyVotes[pollId] = [...optionIds]
    return JSON.parse(JSON.stringify(poll))
  }
  return http.post<Poll>(`/polls/${pollId}/vote`, { optionIds })
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

export async function fetchComments(pollId: string): Promise<Comment[]> {
  if (USE_MOCK) {
    await delay()
    return mockComments.filter((c) => c.pollId === pollId)
  }
  return http.get<Comment[]>(`/polls/${pollId}/comments`)
}

export async function fetchAnswers(pollId: string, cursor?: string | null): Promise<Paged<SurveyAnswer>> {
  if (USE_MOCK) {
    await delay()
    return paginate(
      mockAnswers.filter((a) => a.pollId === pollId),
      cursor
    )
  }
  return http.get<Paged<SurveyAnswer>>(`/polls/${pollId}/answers`, { cursor })
}

export async function submitAnswer(pollId: string, content: string): Promise<SurveyAnswer> {
  if (USE_MOCK) {
    await delay(300)
    const answer: SurveyAnswer = {
      id: `a${Date.now()}`,
      pollId,
      content,
      createdAt: Date.now()
    }
    mockAnswers.unshift(answer)
    mockMyAnswers[pollId] = [...(mockMyAnswers[pollId] ?? []), answer.id]
    const poll = mockPolls.find((p) => p.id === pollId)
    if (poll) poll.answerCount = (poll.answerCount ?? 0) + 1
    return answer
  }
  return http.post<SurveyAnswer>(`/polls/${pollId}/answers`, { content })
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
export async function fetchVoters(pollId: string) {
  if (USE_MOCK) {
    await delay(200)
    return mockVoters(pollId)
  }
  return http.get<ReturnType<typeof mockVoters>>(`/polls/${pollId}/voters`)
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
