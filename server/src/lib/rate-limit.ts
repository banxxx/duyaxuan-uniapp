/**
 * 写接口限流（固定窗口）
 *
 * 目的：挡住脚本刷接口和手滑连点，不是精确的配额系统。
 * 计数放 D1 而不是内存：Worker 的 isolate 随时会被回收，内存计数拦不住。
 *
 * 每个「桶 + 用户/IP」一行。窗口按固定长度切（如 10 分钟对齐到整点），
 * 窗口内第一次请求写入 window_start=该窗口起点、count=1；后续同窗口 +1。
 * 跨窗口的 upsert 直接把 count 重置成 1，不需要先删旧行。
 *
 * 为什么不用滑动窗口：多一次查询、多一次写入，为了限流不值得。
 * 固定窗口最坏情况下边界前后各打满一次，对「防刷」已经够用。
 *
 * 失败策略：限流表写失败不能把正常业务一起打死。除了自己主动抛的 429，
 * 其他数据库异常只记日志、放行 —— 一个漏建表的迁移问题不应该让全站不可用。
 */

import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { clientIp } from './request-ip'
import { HttpError } from './response'

export interface RateLimitRule {
  /** 桶名，会写进 key；同一个动作的 POST/DELETE 共用一个桶 */
  bucket: string
  /** 窗口内允许的次数 */
  limit: number
  /** 窗口长度（毫秒） */
  windowMs: number
}

/**
 * 各写接口的阈值。
 *
 * 数值定得比较宽松：正常用户几乎碰不到，脚本持续刷会被挡住。
 * 真被误伤时先看这里，不要改业务接口。
 */
export const RATE_LIMITS = {
  /**
   * 登录：按 IP。公司 Wi-Fi / 运营商 NAT 后面可能有一群人同时打开，
   * 所以给到 60 次/分钟，只挡脚本级别的轰炸。
   */
  login: { bucket: 'login', limit: 60, windowMs: 60_000 },
  /** 发起投票 / 问卷 */
  pollCreate: { bucket: 'poll-create', limit: 5, windowMs: 600_000 },
  /** 编辑内容：一次编辑可能连点保存 */
  pollEdit: { bucket: 'poll-edit', limit: 30, windowMs: 600_000 },
  /** 删除 / 恢复 / 结束 */
  pollManage: { bucket: 'poll-manage', limit: 10, windowMs: 600_000 },
  /** 分享相关：生成小程序码、取邀请码 */
  pollShare: { bucket: 'poll-share', limit: 30, windowMs: 600_000 },
  /** 截止提醒 */
  remind: { bucket: 'remind', limit: 30, windowMs: 600_000 },
  /** 投票 / 撤回（允许改票时会连续提交） */
  vote: { bucket: 'vote', limit: 60, windowMs: 60_000 },
  /** 发评论 / 删评论 */
  comment: { bucket: 'comment', limit: 20, windowMs: 60_000 },
  /** 评论点赞 / 取消 */
  commentLike: { bucket: 'comment-like', limit: 120, windowMs: 60_000 },
  /** 提交问卷回答 */
  answer: { bucket: 'answer', limit: 20, windowMs: 60_000 },
  /** 修改已提交的回答 */
  answerEdit: { bucket: 'answer-edit', limit: 30, windowMs: 60_000 },
  /** 邀请码校验：防撞码 */
  join: { bucket: 'join', limit: 10, windowMs: 300_000 },
  /** 汇总页的整理操作（新建/编辑/归入/忽略/重新归并） */
  summary: { bucket: 'summary', limit: 120, windowMs: 60_000 },
  /** 上传头像 */
  avatar: { bucket: 'avatar', limit: 5, windowMs: 600_000 },
  /** 改资料 */
  profile: { bucket: 'profile', limit: 10, windowMs: 600_000 },
  /** 解绑平台 */
  unbind: { bucket: 'unbind', limit: 5, windowMs: 600_000 },
  /** 注销账号：不可逆，给足重试余量但不允许脚本反复撞 */
  deactivate: { bucket: 'deactivate', limit: 3, windowMs: 3_600_000 },
  /** 消息已读 / 推送订阅与偏好 */
  notifyWrite: { bucket: 'notify-write', limit: 60, windowMs: 60_000 }
} satisfies Record<string, RateLimitRule>

function retryMessage(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000))
  if (seconds >= 60) return `操作太频繁，请 ${Math.ceil(seconds / 60)} 分钟后再试`
  return `操作太频繁，请 ${seconds} 秒后再试`
}

/**
 * 检查并累加一次调用。超限时抛 429，由 index.ts 的 onError 统一转响应。
 *
 * 已登录用 userId 分桶，未登录（目前只有登录接口）用 IP。
 * IP 也拿不到时统一落到 `unknown`：宁可所有本地请求共用一个桶，
 * 也不要因为取不到 IP 就完全不限流。
 */
export async function enforceRateLimit(
  c: Context<AppEnv>,
  rule: RateLimitRule
): Promise<void> {
  const userId = c.get('userId')
  const subject = userId ? `u:${userId}` : `ip:${clientIp(c) ?? 'unknown'}`
  const key = `${rule.bucket}:${subject}`

  const now = Date.now()
  const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs
  const expiresAt = windowStart + rule.windowMs

  let count: number
  try {
    // 单条 UPSERT + RETURNING 是原子的：并发请求不会各自读到旧 count
    // 再一起写回，从而把次数刷少。
    const row = await c.env.DB.prepare(
      `INSERT INTO rate_limits (key, window_start, count, expires_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE
           WHEN rate_limits.window_start = excluded.window_start
           THEN rate_limits.count + 1
           ELSE 1
         END,
         window_start = excluded.window_start,
         expires_at = excluded.expires_at
       RETURNING count`
    )
      .bind(key, windowStart, expiresAt)
      .first<{ count: number }>()
    count = row?.count ?? 1
  } catch (err) {
    // 漏建 rate_limits 表时不要把所有写接口一起打挂
    console.error('[rate-limit] check failed, request allowed', err)
    return
  }

  if (count > rule.limit) {
    throw new HttpError(429, retryMessage(expiresAt - now))
  }
}

/**
 * 清理过期窗口。Cron 每 5 分钟跑一次，删一天前的行即可：
 * 保留一天是为了排查时还能看到最近谁被限过，表本身很小。
 */
export async function cleanupRateLimits(db: D1Database): Promise<void> {
  await db
    .prepare('DELETE FROM rate_limits WHERE expires_at < ?')
    .bind(Date.now() - 86_400_000)
    .run()
}
