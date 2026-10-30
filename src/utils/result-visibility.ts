import type { Poll } from '@/types/api'

/**
 * 结果能不能被看到 —— 详情 / 结果 / 成功页共用的判断。
 *
 * 规则只有一处，别在三个页面各写一份，改一处漏两处。
 *   发起人            → 永远可见
 *   hidden            → 谁都不可见（发起人除外）
 *   always            → 谁都可
 *   after_end         → 截止后可
 *   after_vote        → 投过票后可
 */
export function canSeePollResult(
  poll: Poll,
  opts: { isOwner?: boolean; hasVoted?: boolean; isEnded?: boolean } = {}
): boolean {
  if (opts.isOwner) return true
  const v = poll.rules.resultVisibility ?? 'after_vote'
  if (v === 'hidden') return false
  if (v === 'always') return true
  if (v === 'after_end') return !!opts.isEnded
  return !!opts.hasVoted
}
