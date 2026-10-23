import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Poll, Paged } from '@/types/api'
import { http } from '@/utils/request'

export type ListTab = 'mine' | 'joined' | 'discover'
export type StatusFilter = 'all' | 'ongoing' | 'ended'

export const usePollStore = defineStore('poll', () => {
  /** 详情缓存：列表点进详情时先渲染缓存，再拉最新，避免白屏 */
  const detailCache = ref<Record<string, Poll>>({})

  function cacheDetail(poll: Poll) {
    detailCache.value[poll.id] = poll
  }

  function getCachedDetail(id: string): Poll | undefined {
    return detailCache.value[id]
  }

  async function fetchDetail(id: string): Promise<Poll> {
    const poll = await http.get<Poll>(`/polls/${id}`)
    cacheDetail(poll)
    return poll
  }

  async function fetchList(
    tab: ListTab,
    status: StatusFilter = 'all',
    cursor?: string | null
  ): Promise<Paged<Poll>> {
    const url =
      tab === 'mine' ? '/polls/mine' : tab === 'joined' ? '/polls/joined' : '/polls/discover'
    return http.get<Paged<Poll>>(url, { status, cursor })
  }

  /** 软删除：列表和分享链接立即下线，服务端保留 5 秒可撤销窗口 */
  async function remove(id: string) {
    await http.del(`/polls/${id}`)
    delete detailCache.value[id]
  }

  /** 撤销删除，仅在 5 秒窗口内有效，服务端超时会返回 410 */
  async function undoRemove(id: string) {
    await http.post(`/polls/${id}/restore`)
  }

  return { detailCache, cacheDetail, getCachedDetail, fetchDetail, fetchList, remove, undoRemove }
})
