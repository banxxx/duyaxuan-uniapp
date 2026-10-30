import type { Poll } from '@/types/api'

/**
 * 跨页面的「删除撤销」交接。
 *
 * 删除有两个入口：41 我发起的列表，和详情页右上角「···」。
 * 列表页自己维护撤销条；详情页删完会退回列表，撤销条却只存在于列表的局部状态里，
 * 不交接的话用户就真的没有 5 秒反悔机会了。
 *
 * 这里只放一条「刚删掉的投票 + 过期时间」，列表页 onShow 时取走并清空。
 * 用模块变量而不是缓存：刷新、重新进入小程序后本就不该还能撤销。
 */
interface PendingUndo {
  poll: Poll
  expiresAt: number
}

let pending: PendingUndo | null = null

/** 服务端给 10 秒窗口，界面只展示 5 秒；这里再留一点导航耗时 */
const UNDO_TTL = 6000

export function setPendingUndo(poll: Poll): void {
  pending = { poll, expiresAt: Date.now() + UNDO_TTL }
}

/** 取走待撤销的投票；超过窗口或已被取走就返回 null */
export function takePendingUndo(): Poll | null {
  const hit = pending
  pending = null
  if (!hit) return null
  return hit.expiresAt > Date.now() ? hit.poll : null
}
