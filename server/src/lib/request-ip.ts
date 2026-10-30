/**
 * 取客户端 IP。
 *
 * Cloudflare 会把真实来源写进 CF-Connecting-IP；本地 wrangler dev / 其他
 * 反代只有 X-Forwarded-For。后者可能是逗号分隔的链路，第一个才是客户端。
 *
 * 只用来做「限同一 IP」和登录限流，不落库展示，所以拿不到就返回 null，
 * 不抛错 —— 本地调试或内网请求没有这两个头是正常的。
 */
export function clientIp(c: {
  req: { header: (name: string) => string | undefined }
}): string | null {
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')
  return ip ? ip.split(',')[0].trim() : null
}
