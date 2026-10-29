import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'
import { verifyToken } from '../lib/jwt'
import { fail } from '../lib/response'

function bearerToken(c: { req: { header: (k: string) => string | undefined } }): string | null {
  const raw = c.req.header('Authorization') ?? ''
  if (!raw.startsWith('Bearer ')) return null
  const token = raw.slice(7).trim()
  return token || null
}

/** 必须登录。没有 / 失效 / 伪造一律 401，前端收到后静默重登一次 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearerToken(c)
  if (!token) return fail(c, 401, '请先登录')

  const payload = await verifyToken(token, c.env.JWT_SECRET)
  if (!payload) return fail(c, 401, '登录已失效，请重新登录')

  // 注销 / 删除的账号不能靠旧 token 继续操作。
  // 这一步会多一次 D1 读，但写接口本来就要查库，换来的是一注销就立刻失效。
  const user = await c.env.DB.prepare('SELECT status FROM users WHERE id = ?')
    .bind(payload.sub)
    .first<{ status: number }>()
  if (!user || user.status !== 0) return fail(c, 401, '登录已失效，请重新登录')

  c.set('userId', payload.sub)
  await next()
})

/**
 * 可登录也可匿名。
 *
 * 发现页、搜索、详情页要能在没登录时看，但登录后又要能带上「我投过没」，
 * 所以这里不拦截，只是尽力解析出 userId。
 */
export const optionalAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearerToken(c)
  const payload = token ? await verifyToken(token, c.env.JWT_SECRET) : null
  c.set('userId', payload?.sub ?? null)
  await next()
})
