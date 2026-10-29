import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { ok } from '../lib/response'
import { requireAuth } from '../middleware/auth'
import { listNotifications, markRead, unreadCount } from '../db/notifications'
import { getPrefs, parsePrefs, recordSubscription, savePrefs, templates } from '../db/push'

const notifications = new Hono<AppEnv>()

// 消息是个人数据，整组都要求登录
notifications.use('*', requireAuth)

notifications.get('/', async (c) => {
  return ok(
    c,
    await listNotifications(c.env.DB, c.get('userId')!, c.req.query('cursor'), c.env)
  )
})

notifications.get('/unread-count', async (c) => {
  return ok(c, { count: await unreadCount(c.env.DB, c.get('userId')!, c.env) })
})

/** 不传 ids = 全部标为已读 */
notifications.post('/read', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown }
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string')
    : null
  return ok(c, { count: await markRead(c.env.DB, c.get('userId')!, ids, c.env) })
})

/**
 * 已配置的订阅消息模板：kind → template_id。
 * 小程序拿它去调 requestSubscribeMessage，模板 ID 只维护在服务端，
 * 前端不用跟着改环境变量。
 */
notifications.get('/templates', (c) => {
  return ok(c, templates(c.env))
})

/**
 * 用户同意订阅之后上报：同意的模板各 +1 次发送额度，顺带同步推送偏好。
 * 只接受当前环境配置过的模板 ID，随便传一个别的不会写进表里。
 */
notifications.post('/subscribe', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    templateIds?: unknown
    prefs?: unknown
  }
  const allowed = new Set(Object.values(templates(c.env)))
  const ids = Array.isArray(body.templateIds)
    ? body.templateIds.filter(
        (id): id is string => typeof id === 'string' && allowed.has(id)
      )
    : []

  await recordSubscription(c.env.DB, c.get('userId')!, ids, parsePrefs(body.prefs))
  return ok(c, { accepted: ids.length })
})

/** 推送开关：订阅消息是服务端发的，本地开关必须同步一份上来 */
notifications.post('/prefs', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { prefs?: unknown }
  const patch = parsePrefs(body.prefs)
  if (!patch) return ok(c, await getPrefs(c.env.DB, c.get('userId')!))
  return ok(c, await savePrefs(c.env.DB, c.get('userId')!, patch))
})

export default notifications
