import type { Notification, Paged } from '@/types/api'
import { http } from '@/utils/request'
import { useMock } from '@/utils/env'
import { mockNotifications } from '@/mock/data'

/**
 * 消息通知 / 反馈
 *
 * 两层通知：
 *   - 站内消息：参与、评论、回复、截止提醒，进小程序才看得到
 *   - 微信订阅消息：用户在小程序里同意一次，微信推一条服务通知
 *
 * 模板 ID 只在服务端配置，前端通过 /notifications/templates 取，
 * 没配置时返回空对象，前端就不弹授权框。
 */
const USE_MOCK = useMock()
const PAGE_SIZE = 20

export type PushKind = 'joined' | 'comment' | 'deadline' | 'result' | 'updated'

/** 服务端的推送偏好；和小程序本地开关是两回事，这个决定「服务端发不发」 */
export interface PushPrefs {
  enabled: boolean
  joined: boolean
  comment: boolean
  deadline: boolean
  result: boolean
  updated: boolean
}

const delay = (ms = 160) => new Promise((r) => setTimeout(r, ms))

export async function fetchNotifications(cursor?: string | null): Promise<Paged<Notification>> {
  if (USE_MOCK) {
    await delay()
    const start = cursor ? Number(cursor) : 0
    const slice = mockNotifications.slice(start, start + PAGE_SIZE)
    const next = start + PAGE_SIZE
    return {
      list: slice.map((n) => ({ ...n })),
      cursor: next < mockNotifications.length ? String(next) : null,
      hasMore: next < mockNotifications.length,
      total: mockNotifications.length
    }
  }
  return http.get<Paged<Notification>>('/notifications', { cursor })
}

export async function fetchUnreadCount(): Promise<number> {
  if (USE_MOCK) {
    await delay(80)
    return mockNotifications.filter((n) => !n.read).length
  }
  const res = await http.get<{ count: number }>('/notifications/unread-count', undefined, {
    toast: false
  })
  return res.count
}

/** 不传 ids = 全部标为已读；返回剩余未读数 */
export async function markNotificationsRead(ids?: string[]): Promise<number> {
  if (USE_MOCK) {
    await delay(120)
    mockNotifications.forEach((n) => {
      if (!ids || ids.includes(n.id)) n.read = true
    })
    return mockNotifications.filter((n) => !n.read).length
  }
  const res = await http.post<{ count: number }>('/notifications/read', { ids })
  return res.count
}

/**
 * 已配置的订阅消息模板（kind → template_id）。
 * 模板 ID 只维护在服务端，前端不用跟着改环境变量。
 */
export async function fetchSubscribeTemplates(): Promise<Partial<Record<PushKind, string>>> {
  if (USE_MOCK) return {}
  return http.get<Partial<Record<PushKind, string>>>(
    '/notifications/templates',
    undefined,
    { toast: false }
  )
}

/** 用户同意订阅后上报：服务端给对应模板 +1 次发送额度 */
export async function reportSubscribe(
  templateIds: string[],
  prefs?: PushPrefs
): Promise<void> {
  if (USE_MOCK || !templateIds.length) return
  await http.post<void>('/notifications/subscribe', { templateIds, prefs }, { toast: false })
}

/** 推送开关同步到服务端 —— 订阅消息是服务端发的，只存本地拦不住 */
export async function savePushPrefs(prefs: PushPrefs): Promise<void> {
  if (USE_MOCK) return
  await http.post<void>('/notifications/prefs', { prefs }, { toast: false })
}

/** 58 帮助与反馈 */
export async function submitFeedback(content: string): Promise<void> {
  if (USE_MOCK) {
    await delay(320)
    return
  }
  return http.post<void>('/feedback', { content })
}
