import fs from 'node:fs'
import crypto from 'node:crypto'

const vars = Object.fromEntries(
  fs
    .readFileSync('.dev.vars', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1)]
    })
)

function tokenFor(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ sub, iat: now, exp: now + 3600 })
  const sig = crypto.createHmac('sha256', vars.JWT_SECRET).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

const BASE = 'http://127.0.0.1:8787'
const OWNER = 'u_mvshxifpu4pn4qcw'
const OTHER = 'u_seed1'
const POLL = 'p_mvt19r84vurpomz1'

async function call(as, method, path, payload) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(as)}` },
    body: payload ? JSON.stringify(payload) : undefined
  })
  const json = await res.json()
  console.log(as === OWNER ? '[owner]' : '[other]', method, path, '→', res.status, JSON.stringify(json).slice(0, 220))
  return json
}

console.log('=== other 提交问卷回答 → owner 收到 joined ===')
await call(OTHER, 'POST', `/polls/${POLL}/answers`, { content: '通知联调回答' })

console.log('=== other 评论 → owner 收到 comment ===')
const c = await call(OTHER, 'POST', `/polls/${POLL}/comments`, { content: '通知联调评论' })

console.log('=== owner 回复 other 的评论 → other 收到回复通知 ===')
await call(OWNER, 'POST', `/polls/${POLL}/comments`, { content: '收到，谢谢', replyToId: c.data.id })

console.log('=== owner 通知列表 ===')
const ownerList = await call(OWNER, 'GET', '/notifications')
console.log('owner 未读数：', (await call(OWNER, 'GET', '/notifications/unread-count')).data)

console.log('=== other 通知列表（只应有一条回复） ===')
await call(OTHER, 'GET', '/notifications')

console.log('=== 标为已读 ===')
await call(OWNER, 'POST', '/notifications/read', { ids: ownerList.data.list.map((n) => n.id) })
console.log('owner 剩余未读：', (await call(OWNER, 'GET', '/notifications/unread-count')).data)

