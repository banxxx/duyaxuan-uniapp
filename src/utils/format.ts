/**
 * 展示层格式化
 *
 * 设计稿里的时间文案都是「10 月 22 日」「剩 3 天」「2 分钟前」这类，
 * 统一在这里算，避免每个页面各写一套。
 */

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** 10 月 22 日 */
export function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/** 10 月 22 日 12:00 */
export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${formatDate(ts)} ${hh}:${mm}`
}

/** 10 月 20 日 14:32 创建 · 匿名投票 */
export function formatCreatedAt(ts: number, suffix: string): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${formatDate(ts)} ${hh}:${mm} ${suffix}`
}

/** 今天 14:32 / 昨天 18:05 / 10 月 20 日 09:12 */
export function formatMoment(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  if (ts >= startOfToday) return `今天 ${hh}:${mm}`
  if (ts >= startOfToday - DAY) return `昨天 ${hh}:${mm}`
  return `${formatDate(ts)} ${hh}:${mm}`
}

/** 2 分钟前 / 3 小时前 / 昨天 / 10 月 20 日 */
export function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  if (diff < MINUTE) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`
  if (diff < 2 * DAY) return '昨天'
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} 天前`
  return formatDate(ts)
}

/** 剩 3 天 / 剩 3 天 6 小时 / 已结束 */
export function formatRemaining(endAt: number, now = Date.now()): string {
  const diff = endAt - now
  if (diff <= 0) return '已结束'

  const days = Math.floor(diff / DAY)
  const hours = Math.floor((diff % DAY) / HOUR)

  if (days >= 1) {
    return hours > 0 && days < 3 ? `剩 ${days} 天 ${hours} 小时` : `剩 ${days} 天`
  }
  if (hours >= 1) return `剩 ${hours} 小时`
  return `剩 ${Math.max(1, Math.floor(diff / MINUTE))} 分钟`
}

/** 票数展示：小于 1000 直接显示，大于等于 1000 显示 1.3k */
export function formatCount(n: number): string {
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
}

/** 百分比：总数为 0 时返回 0，不做除零 */
export function percent(part: number, total: number): number {
  if (!total) return 0
  return Math.round((part / total) * 100)
}

/** 字面量长度（按字符算，中文算 1） */
export function charCount(s: string): number {
  return Array.from(s).length
}
