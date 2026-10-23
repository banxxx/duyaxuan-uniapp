/**
 * 分享
 *
 * 小程序之间不能直接互跳，微信卡片在抖音里也打不开。
 * 当前阶段只做同平台分享卡片；跨平台海报后续补（需要 H5 落地页）。
 */

import { getPlatform } from './platform'
import type { Poll } from '@/types/api'

/** 拼分享路径，带上来源平台，便于后端统计跨端转化 */
export function sharePath(poll: Poll): string {
  return `/pages/detail/index?id=${poll.id}&from=${getPlatform()}`
}

/** 生成 onShareAppMessage 需要的对象 */
export function buildShareMessage(poll: Poll) {
  const kind = poll.type === 'survey' ? '问卷' : '投票'
  return {
    title: poll.title,
    path: sharePath(poll),
    imageUrl: '' // 后续接海报生成后填
  }
}

/** 生成 onShareTimeline 需要的对象（仅微信支持） */
export function buildTimelineMessage(poll: Poll) {
  return {
    title: `${poll.title} · 来投一票`,
    query: `id=${poll.id}`
  }
}
