/**
 * 分享
 *
 * 小程序之间不能直接互跳，微信卡片在抖音里也打不开。
 * 当前阶段只做同平台分享卡片；跨平台海报后续补（需要 H5 落地页）。
 */

import { getPlatform, isWeixinLike } from './platform'
import type { Poll } from '@/types/api'

/**
 * 拼分享路径。
 *
 * 统一走 pages/share/join 落地页：对方点开时再判断「问卷还没填就去填写页、
 * 投过票或已结束就去详情页」，分享卡片本身不用关心这些规则。
 * 小程序码的 scene 也落到同一页，两条入口行为一致。
 */
export function sharePath(poll: Poll): string {
  // 邀请码不拼进链接：它必须由发起人单独告知。
  // 拼进去等于「转发即准入」，邀请码就失去了二次验证的意义。
  return `/pages/share/join?id=${poll.id}&from=${getPlatform()}`
}

/** 朋友圈 query 用同一份参数，只是不带 from（打开的是当前页） */
export function shareQuery(poll: Poll): string {
  return `id=${poll.id}`
}

/**
 * 右上角「···」里的转发和页面内的分享按钮是一回事。
 *
 * 发起人关掉「允许分享」后，菜单里也不该还能转发出去，
 * 否则页面里的分享按钮藏了，用户还能从胶囊绕过这个限制。
 * 每个能拿到 Poll 的页面在加载完成后调用一次即可。
 */
export function syncShareMenu(allowShare: boolean): void {
  // 抖音/H5 没有胶囊菜单，调了只会多一条控制台警告
  if (!isWeixinLike()) return
  // 允许分享时什么都不用做：页面注册了 onShareAppMessage，菜单默认就是开的。
  // 反过来调 showShareMenu，在开发者工具/还没发布的版本上会报
  // 「showShareMenu:fail no permission」，而且会冒到全局日志里。
  if (allowShare) return
  uni.hideShareMenu({
    hideShareItems: ['shareAppMessage', 'shareTimeline'],
    // 老基础库上这个接口本身就可能失败，失败也不该影响页面
    fail: () => {}
  })
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
    query: shareQuery(poll)
  }
}
