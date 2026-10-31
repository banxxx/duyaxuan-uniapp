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
import { API_BASE, resolveFileUrl } from '@/utils/api-base'
import { currentToken } from '@/utils/auth-token'
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

/**
 * 兼容两种后端返回：
 *   旧版列表接口直接返回数组，新版返回 { list, cursor, hasMore, total }。
 *
 * 必须统一成 Paged：否则在旧后端上 `res.list` 是 undefined，页面 render 时
 * 读 `.length` / `.filter` 会抛错，Vue 停在上一帧 —— 表现就是骨架屏一直不消失，
 * 而且请求本身是 200，请求层的超时也不会触发。
 */
function toPaged<T>(data: T[] | Paged<T> | null | undefined): Paged<T> {
  if (Array.isArray(data)) {
    return { list: data, cursor: null, hasMore: false, total: data.length }
  }
  if (!data) return { list: [], cursor: null, hasMore: false, total: 0 }
  const list = Array.isArray(data.list) ? data.list : []
  return {
    list,
    cursor: data.cursor ?? null,
    hasMore: !!data.hasMore,
    total: typeof data.total === 'number' ? data.total : list.length
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
  return toPaged(await http.get<Paged<Poll> | Poll[]>('/polls/mine', { status, cursor }))
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
  return toPaged(await http.get<Paged<Poll> | Poll[]>('/polls/joined', { status, cursor }))
}

/** 02 首页 · 待我投票：别人邀请我、我还没投的，按截止时间由近到远 */
export async function fetchPendingPolls(
  limit?: number,
  cursor?: string | null
): Promise<Paged<PendingPoll>> {
  if (USE_MOCK) {
    await delay(200)
    const page = mockPending.slice(0, limit ?? mockPending.length)
    return {
      list: page,
      cursor: null,
      hasMore: page.length < mockPending.length,
      total: mockPending.length
    }
  }
  return toPaged(
    await http.get<Paged<PendingPoll> | PendingPoll[]>('/polls/pending', { limit, cursor })
  )
}

export async function fetchDiscoverPolls(
  status: 'all' | 'ongoing' | 'ended' = 'all',
  cursor?: string | null
): Promise<Paged<Poll>> {
  if (USE_MOCK) {
    await delay()
    return paginate(mockPolls, cursor)
  }
  return toPaged(await http.get<Paged<Poll> | Poll[]>('/polls/discover', { status, cursor }))
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

/**
 * 上传图文投票的选项配图，返回服务端相对地址（/files/options/...）。
 *
 * 和头像上传一样走 uni.uploadFile：JSON 请求塞不下 multipart，
 * 而且 uploadFile 不会帮我们解包 { code, data, msg }，得自己来。
 */
export function uploadPollImage(filePath: string): Promise<string> {
  // mock 模式没有 R2，直接把本地临时路径当结果返回，页面预览照样能看到图
  if (USE_MOCK) {
    return new Promise((resolve) => setTimeout(() => resolve(filePath), 260))
  }

  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: `${API_BASE}/polls/media`,
      filePath,
      name: 'file',
      header: { Authorization: `Bearer ${currentToken()}` },
      success: (res) => {
        try {
          const body = JSON.parse(res.data) as { code: number; data?: { url: string }; msg?: string }
          if (res.statusCode === 401) {
            reject(new Error('登录已失效，请重新登录'))
            return
          }
          if (body.code !== 0 || !body.data?.url) {
            reject(new Error(body.msg || '上传失败'))
            return
          }
          resolve(body.data.url)
        } catch {
          reject(new Error('上传失败，请重试'))
        }
      },
      fail: () => reject(new Error('上传失败，请重试'))
    })
  })
}

/** 创建投票 / 问卷：body 直接就是 draft 的形状，服务端自己拆表 */
export async function createPoll(body: Record<string, any>): Promise<Poll> {
  if (USE_MOCK) {
    await delay(320)
    const draftOptions = (body.options ?? []) as Array<{
      title: string
      desc?: string
      images?: string[]
    }>
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
              images: o.images?.length ? [...o.images] : undefined,
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
    // 只改主题/说明的页面不会带 rules，不能把已有规则冲成 undefined
    if (body.rules) hit.rules = body.rules
    if (body.type !== 'survey' && Array.isArray(body.options)) {
      hit.options = body.options.map((o: any, i: number) => ({
        id: o.id ?? `o_new_${i}`,
        title: o.title,
        desc: o.desc,
        images: o.images?.length ? [...o.images] : undefined,
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

/**
 * 撤销删除。失败时「我发起的」页要给「已超出可撤销时间」这种更具体的文案，
 * 所以这里关掉请求层的通用提示，由页面统一说明。
 */
export async function restorePoll(id: string): Promise<void> {
  if (USE_MOCK) {
    await delay(200)
    return
  }
  return http.post<void>(`/polls/${id}/restore`, undefined, { toast: false })
}

export async function fetchComments(
  pollId: string,
  opts?: { toast?: boolean; cursor?: string | null; sort?: 'latest' | 'hot' }
): Promise<Paged<Comment>> {
  if (USE_MOCK) {
    await delay()
    const list = mockComments.filter((c) => c.pollId === pollId)
    if (opts?.sort === 'hot') list.sort((a, b) => b.likeCount - a.likeCount)
    return paginate(list, opts?.cursor ?? null, 50)
  }
  return toPaged(
    await http.get<Paged<Comment> | Comment[]>(
      `/polls/${pollId}/comments`,
      { cursor: opts?.cursor ?? null, sort: opts?.sort ?? 'latest' },
      opts
    )
  )
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
  return toPaged(
    await http.get<Paged<SurveyAnswer> | SurveyAnswer[]>(`/polls/${pollId}/answers`, { cursor }, opts)
  )
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
  cursor?: string | null,
  opts?: { toast?: boolean }
): Promise<Paged<VoterRecord>> {
  if (USE_MOCK) {
    await delay(200)
    const list = mockVoters(pollId)
    return { list, cursor: null, hasMore: false, total: list.length }
  }
  return toPaged(
    await http.get<Paged<VoterRecord> | VoterRecord[]>(`/polls/${pollId}/voters`, { cursor }, opts)
  )
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
  // 首次生成要调微信接口 + 写 R2，比普通查询慢，单独放宽到 20s
  const res = await http.get<{ url: string }>(`/polls/${pollId}/qrcode`, undefined, {
    toast: false,
    timeout: 20000
  })
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
export async function fetchUnclassified(
  pollId: string,
  cursor?: string | null
): Promise<Paged<UnclassifiedAnswer>> {
  if (USE_MOCK) {
    await delay(150)
    return paginate(mockUnclassified, cursor, 100)
  }
  return toPaged(
    await http.get<Paged<UnclassifiedAnswer> | UnclassifiedAnswer[]>(
      `/polls/${pollId}/summary/unclassified`,
      { cursor }
    )
  )
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
export function ignoreSummaryAnswers(
  pollId: string,
  answerIds: string[],
  all = false
): Promise<{ ignored: number }> {
  return summaryWrite(() =>
    http.post<{ ignored: number }>(`/polls/${pollId}/summary/ignore`, { answerIds, all })
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
