import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppEnv } from './types'
import { fail, HttpError } from './lib/response'
import auth from './routes/auth'
import user from './routes/user'
import polls from './routes/polls'
import files from './routes/files'
import notifications from './routes/notifications'
import feedback from './routes/feedback'
import { flushScheduled } from './db/notifications'
import type { Env } from './types'

/**
 * 杜雅轩 API
 *
 * 路由前缀和前端 src/api/*.ts 里的路径一一对应，没有额外的 /v1 ——
 * 小程序端的 VITE_API_BASE_URL 直接填 https://<worker>.workers.dev 就行。
 * 将来要加版本号，在这里 app.route('/v1', ...) 套一层即可。
 */
const app = new Hono<AppEnv>()

// 小程序请求不受 CORS 限制，但 H5 调试（localhost:5173）会跨域，顺手开了
app.use('*', cors())

app.get('/health', (c) => c.json({ ok: true, now: Date.now() }))

app.route('/auth', auth)
app.route('/user', user)
app.route('/polls', polls)
app.route('/files', files)
app.route('/notifications', notifications)
app.route('/feedback', feedback)

app.notFound((c) => fail(c, 404, '接口不存在'))

app.onError((err, c) => {
  if (err instanceof HttpError) return fail(c, err.status, err.message)
  // D1 唯一索引冲突兜底：并发重复投票时会走到这里
  if (String(err?.message ?? '').includes('UNIQUE constraint failed')) {
    return fail(c, 409, '操作太频繁，请刷新后重试')
  }
  console.error('[unhandled]', err)
  return fail(c, 500, '服务器开小差了，请稍后再试')
})

/**
 * 导出成 Worker 的模块格式：HTTP 请求走 Hono，定时任务走 scheduled。
 *
 * Cron Trigger 在 wrangler.toml 的 [triggers] 里配置（默认 5 分钟一次）。
 * 本地调试用 curl http://127.0.0.1:8787/cdn-cgi/local/scheduled 手动触发。
 */
export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      flushScheduled(env).catch((err) => console.error('[cron] 补发通知失败', err))
    )
  }
}
