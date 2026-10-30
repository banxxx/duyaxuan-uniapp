import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { ok, HttpError } from '../lib/response'
import { enforceRateLimit, RATE_LIMITS } from '../lib/rate-limit'
import { requireAuth } from '../middleware/auth'
import { deactivate, getProfile, unbindPlatform, updateProfile } from '../db/users'
import {
  avatarKey,
  imageExt,
  keyFromPublicUrl,
  MAX_AVATAR_BYTES,
  mimeByExt,
  publicUrl
} from '../lib/storage'

const user = new Hono<AppEnv>()

user.use('*', requireAuth)

user.get('/profile', async (c) => {
  return ok(c, await getProfile(c.env.DB, c.get('userId')!))
})

/** 只允许改昵称 / 头像 / 简介。手机号和密码已经去掉，登录完全依赖平台授权 */
user.put('/profile', async (c) => {
  await enforceRateLimit(c, RATE_LIMITS.profile)
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  return ok(
    c,
    await updateProfile(c.env.DB, c.get('userId')!, {
      nickname: body.nickname,
      avatar: body.avatar,
      bio: body.bio
    })
  )
})

/**
 * 上传头像。
 *
 * 前端 `<button open-type="chooseAvatar">` 拿到的是临时文件路径，
 * 不能直接存 —— 过一段时间就失效了，必须传上来。
 *
 * 用 multipart 而不是 base64：base64 会让请求体积膨胀 1/3，
 * 而且小程序 uni.uploadFile 本来就是 multipart，天然对上。
 */
user.post('/avatar', async (c) => {
  await enforceRateLimit(c, RATE_LIMITS.avatar)
  const bucket = c.env.BUCKET
  if (!bucket) throw new HttpError(501, '头像存储还没配置（R2 未绑定）')

  const userId = c.get('userId')!
  const form = await c.req.parseBody()
  const file = form.file
  if (!(file instanceof File)) throw new HttpError(400, '没有收到图片')

  const ext = imageExt(file.type, file.name)
  if (!ext) throw new HttpError(400, '只支持 jpg / png / webp / gif')
  if (!file.size) throw new HttpError(400, '图片是空的')
  if (file.size > MAX_AVATAR_BYTES) throw new HttpError(400, '图片不能超过 2MB')

  const before = await getProfile(c.env.DB, userId)
  const key = avatarKey(userId, ext)

  // 按扩展名写 Content-Type，不用客户端传来的值：
  // 上传时把 .jpg 的 type 伪造成 text/html，读文件时就会变成存储型 XSS。
  await bucket.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: mimeByExt(ext) }
  })

  const profile = await updateProfile(c.env.DB, userId, { avatar: publicUrl(key) })

  // 换头像后删掉旧图，不然 R2 里会一直堆没人引用的对象
  const oldKey = before.avatar ? keyFromPublicUrl(before.avatar) : null
  if (oldKey && oldKey !== key) {
    c.executionCtx.waitUntil(bucket.delete(oldKey).catch(() => {}))
  }

  return ok(c, profile)
})

/**
 * 注销账号。
 *
 * 以前要输密码做二次确认，现在没有密码了，改由前端弹二次确认框，
 * 服务端只校验登录态。
 */
user.post('/deactivate', async (c) => {
  await enforceRateLimit(c, RATE_LIMITS.deactivate)
  const userId = c.get('userId')!
  // 注销会把资料清空，先记下头像对象，之后把 R2 里那图也删掉
  const before = await getProfile(c.env.DB, userId)
  const oldKey = before.avatar ? keyFromPublicUrl(before.avatar) : null

  await deactivate(c.env.DB, userId)

  if (oldKey && c.env.BUCKET) {
    c.executionCtx.waitUntil(c.env.BUCKET.delete(oldKey).catch(() => {}))
  }
  return ok(c, null)
})

/** 解绑平台，返回解绑后的资料（bound 会变成 false） */
user.post('/unbind', async (c) => {
  await enforceRateLimit(c, RATE_LIMITS.unbind)
  const body = (await c.req.json().catch(() => ({}))) as { platform?: string }
  return ok(c, await unbindPlatform(c.env.DB, c.get('userId')!, body.platform || 'weixin'))
})

export default user
