import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { ok, HttpError } from '../lib/response'
import { weixinCode2Session } from '../lib/oauth'
import { signToken } from '../lib/jwt'
import { findById, loginOrRegister, toProfile } from '../db/users'

const auth = new Hono<AppEnv>()

/**
 * POST /auth/login
 * body: { platform: 'weixin', code: string }
 *
 * 前端 uni.login 拿到 code 传过来，这里换 openid → 登录或注册 → 签 token。
 * token 过期后前端会再走一次这个接口拿新的，没有单独的 refresh。
 */
auth.post('/login', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { platform?: string; code?: string }

  const platform = body.platform || 'weixin'
  if (!body.code) throw new HttpError(400, '缺少登录凭证')
  if (platform !== 'weixin') {
    // QQ / 抖音还没申请账号，接口先留着，别让前端拿到一个假的 token
    throw new HttpError(501, '暂时只支持微信登录')
  }

  const session = await weixinCode2Session(body.code, c.env.WX_APPID, c.env.WX_SECRET)
  const user = await loginOrRegister(c.env.DB, platform, session.openid, session.unionid)

  const ttlDays = Number(c.env.TOKEN_TTL_DAYS) || 7
  const token = await signToken(user.id, c.env.JWT_SECRET, ttlDays * 86_400)

  return ok(c, { token, user: toProfile(user, true) })
})

/* ============================================================
 * 开发期免授权登录
 *
 * 多账号流程（发起人 / 参与者 / 匿名）在真机上来回切微信账号太慢，
 * 这里给一个只在 .dev.vars 打开开关后才存在的接口：
 * 直接按 userId 签 token，不换 openid。
 *
 * 线上没有 DEV_LOGIN 变量，下面两个接口一律 404 —— 不存在被误开的风险。
 * ============================================================ */

function devEnabled(env: { DEV_LOGIN?: string }): boolean {
  // wrangler 把 .dev.vars 的值当字符串读；这里同时兼容布尔和其他写法
  return String(env.DEV_LOGIN ?? '').trim() === 'true'
}

/** 可切换的测试账号：种子数据里的那几个 */
auth.get('/dev-accounts', async (c) => {
  if (!devEnabled(c.env)) throw new HttpError(404, '接口不存在')
  // 真实账号排最前，其次是种子里的四个主账号，凑人数的用户排最后
  const { results } = await c.env.DB.prepare(
    `SELECT id, nickname, avatar FROM users WHERE status = 0
     ORDER BY CASE WHEN id LIKE 'seed_u_v%' THEN 2 WHEN id LIKE 'seed%' THEN 1 ELSE 0 END,
              created_at ASC
     LIMIT 20`
  ).all<{ id: string; nickname: string; avatar: string | null }>()
  return ok(
    c,
    results.map((u) => ({ id: u.id, nickname: u.nickname, avatar: u.avatar ?? undefined }))
  )
})

auth.post('/dev-login', async (c) => {
  if (!devEnabled(c.env)) throw new HttpError(404, '接口不存在')

  const body = (await c.req.json().catch(() => ({}))) as { userId?: string }
  if (!body.userId) throw new HttpError(400, '缺少 userId')

  const user = await findById(c.env.DB, body.userId)
  if (!user || user.status !== 0) throw new HttpError(404, '账号不存在')

  const ttlDays = Number(c.env.TOKEN_TTL_DAYS) || 7
  const token = await signToken(user.id, c.env.JWT_SECRET, ttlDays * 86_400)
  return ok(c, { token, user: toProfile(user, true) })
})

export default auth
