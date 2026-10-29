import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { fail } from '../lib/response'
import { isPublicKey, publicFileMime } from '../lib/storage'

/**
 * 读文件：GET /files/<key>
 *
 * 不开放 r2.dev 公网地址，而是让 Worker 自己转发。原因有两个：
 *   1. 小程序只认已配置的 request 域名，多一个 r2.dev 就多一份配置负担；
 *   2. 本地 wrangler dev 的 R2 是 miniflare 模拟的，没有公网地址，
 *      走这条路本地和线上行为完全一致。
 *
 * 这个路由不需要登录：<image> 标签发不出 Authorization 头。
 */
const files = new Hono<AppEnv>()

files.get('/*', async (c) => {
  const bucket = c.env.BUCKET
  if (!bucket) return fail(c, 501, '文件存储还没配置')

  // 用原始 path 削前缀，不依赖通配参数的名字
  const key = c.req.path.replace(/^\/files\/?/, '')
  if (!isPublicKey(key)) return fail(c, 404, '文件不存在')

  const obj = await bucket.get(key)
  if (!obj) return fail(c, 404, '文件不存在')

  return new Response(obj.body, {
    headers: {
      // 不信任对象里存的 Content-Type：旧头像可能是按客户端 MIME 存进去的。
      // 这里只按扩展名返回图片类型，再加 nosniff，避免被当成 HTML 执行。
      'Content-Type': publicFileMime(key),
      'X-Content-Type-Options': 'nosniff',
      // 键里带时间戳，同一个键的内容永远不会变，可以放心长缓存
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: obj.httpEtag
    }
  })
})

export default files
