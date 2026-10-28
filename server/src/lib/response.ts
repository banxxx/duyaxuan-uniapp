/**
 * 统一响应
 *
 * 前端 request.ts 的解包规则：
 *   - HTTP 2xx 且 body.code === 0  → 返回 body.data
 *   - HTTP 非 2xx                   → 抛 ApiError(status, body.msg)
 *   - HTTP 401                      → 静默重新登录后重试一次
 *
 * 所以失败时 HTTP 状态码必须是真的（不能 200 + code:500），
 * 否则 401 那条自动重登逻辑永远触发不到。
 */

import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ code: 0, data }, status)
}

export function fail(c: Context, status: ContentfulStatusCode, msg: string) {
  return c.json({ code: status, data: null, msg }, status)
}

/**
 * 业务异常。路由里直接 throw，由 index.ts 的 onError 统一转成响应，
 * 省掉每层 return fail(...) 的类型体操。
 */
export class HttpError extends Error {
  status: ContentfulStatusCode

  constructor(status: ContentfulStatusCode, message: string) {
    super(message)
    this.status = status
    this.name = 'HttpError'
  }
}
