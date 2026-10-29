import {
  fetchSubscribeTemplates,
  reportSubscribe,
  type PushKind,
  type PushPrefs
} from '@/api/notification'
import { getPlatform } from './platform'

/**
 * 微信订阅消息授权
 *
 * 微信的规则很硬：requestSubscribeMessage 必须在**点击事件里同步调用**，
 * 所以模板 ID 得提前拿到 —— 点的时候再 await 一次网络请求，手势上下文就丢了，
 * 弹窗不会出现（或者直接报 fail）。
 *
 * 所以拆成两步：
 *   1. preloadSubscribeTemplates() 页面加载时拉一次，缓存住
 *   2. requestSubscribe(kinds) 在 tap 回调里同步调用
 *
 * 每次同意只换一条消息的额度，发完就没了，用户下次还得再点一次。
 * 这是微信的设计，不是我们没做成「永久订阅」。
 */

let cache: Partial<Record<PushKind, string>> | null = null
let loading: Promise<void> | null = null

/**
 * 页面加载时调用；失败就静默，没模板时前端什么都不弹。
 * 返回的 Promise 只用来决定「要不要显示开启提醒的入口」，等不到也没关系。
 */
export function preloadSubscribeTemplates(): Promise<void> {
  if (cache) return Promise.resolve()
  if (loading) return loading
  if (getPlatform() !== 'weixin') return Promise.resolve()

  loading = fetchSubscribeTemplates()
    .then((t) => {
      cache = t
    })
    .catch(() => {
      // 未登录 / 网络问题：当作没配置，不打断页面
    })
    .finally(() => {
      loading = null
    })
  return loading
}

/** 当前有没有可用模板（设置页用来决定提示文案） */
export function hasSubscribeTemplates(): boolean {
  return !!cache && Object.keys(cache).length > 0
}

/**
 * 请求订阅授权。**只能在点击事件里调用**。
 *
 * 微信一次最多 3 个模板，多传会被拒；这里截断到 3。
 * onDone 拿到的是用户实际同意的模板 ID，没同意就是空数组。
 */
export function requestSubscribe(
  kinds: PushKind[],
  prefs?: PushPrefs,
  onDone?: (accepted: string[]) => void
): void {
  if (getPlatform() !== 'weixin') return

  // 四类通知可能共用一个模板，去重后再传 —— 微信不接受重复的 tmplIds
  const ids = [
    ...new Set(kinds.map((k) => cache?.[k]).filter((id): id is string => !!id))
  ].slice(0, 3)
  if (!ids.length) return

  uni.requestSubscribeMessage({
    tmplIds: ids,
    success: (res) => {
      const result = res as unknown as Record<string, string>
      const accepted = ids.filter((id) => result[id] === 'accept')
      if (accepted.length) {
        // 上报失败不影响用户操作：额度少一次而已，站内消息照常
        reportSubscribe(accepted, prefs).catch(() => {})
      }
      onDone?.(accepted)
    },
    fail: () => onDone?.([])
  })
}
