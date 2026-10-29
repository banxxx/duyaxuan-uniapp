import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { ok, HttpError } from '../lib/response'
import { optionalAuth } from '../middleware/auth'
import { newId } from '../lib/id'

const feedback = new Hono<AppEnv>()

// 帮助页未登录也能看，反馈就不强制登录；有 token 就顺手记下是谁
feedback.use('*', optionalAuth)

feedback.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    content?: unknown
    contact?: unknown
  }
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (content.length < 5) throw new HttpError(400, '请至少写 5 个字')
  if (content.length > 1000) throw new HttpError(400, '反馈最多 1000 字')
  const contact =
    typeof body.contact === 'string' && body.contact.trim() ? body.contact.trim().slice(0, 100) : null

  await c.env.DB.prepare(
    'INSERT INTO feedback (id, user_id, content, contact, created_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(newId('f'), c.get('userId'), content, contact, Date.now())
    .run()

  return ok(c, null)
})

export default feedback
