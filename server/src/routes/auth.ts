import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { ok, HttpError } from '../lib/response'
import { weixinCode2Session } from '../lib/oauth'
import { signToken } from '../lib/jwt'
import { loginOrRegister, toProfile } from '../db/users'

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

export default auth
