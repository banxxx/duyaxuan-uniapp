import { HttpError } from '../lib/response'
import { QRCODE_PREFIX, publicUrl } from '../lib/storage'
import { accessToken, envVersion, resetAccessToken } from '../lib/wx'
import type { Env } from '../types'

/**
 * 小程序码
 *
 * 用 wxacode.getUnlimited：永久有效、数量不限，参数放在 scene 里（最多 32 字符）。
 * 海报、分享页都用它，扫码后落到 pages/share/join，由那个页面解析 scene 再分流。
 *
 * 两个容易踩的坑：
 *   1. 小程序没发布时，必须 check_path=false + env_version=trial/develop，
 *      否则接口直接报「page not exist」，或者扫码跳向不存在的正式版。
 *   2. access_token 有频率限制，必须缓存。Worker 没有跨请求内存，缓存在 D1。
 */

/* access_token / env_version 在 lib/wx.ts，和订阅消息共用一份缓存 */

/**
 * 拿这条投票的小程序码，返回可访问的相对地址 `/files/qrcodes/...`
 *
 * 同一 poll + 同一环境只生成一次，之后直接读 R2 —— 每个码都要调一次微信接口，
 * 而且页面渲染时会被反复请求，不缓存会很浪费。
 */
export async function getPollQrcode(
  db: D1Database,
  bucket: R2Bucket | undefined,
  env: Env,
  pollId: string,
  inviteCode?: string
): Promise<string> {
  if (!bucket) throw new HttpError(501, '文件存储还没配置')

  const version = envVersion(env.WX_ENV_VERSION)
  // 邀请码进 scene：扫进来直接带上，不用让用户手输
  const scene = inviteCode ? `${pollId}-${inviteCode}` : pollId
  const key = `${QRCODE_PREFIX}${pollId}-${version}${inviteCode ? `-${inviteCode}` : ''}.png`

  const cached = await bucket.head(key)
  if (cached) return publicUrl(key)

  /**
   * 调一次微信接口拿图。
   *
   * retry=true 时，遇到 40001/42001（token 失效或被别处顶掉）就清掉缓存、
   * 重新拿一次 —— 否则这张码会一直失败到 token 自然过期，用户看到的就是
   * 「小程序码还没准备好，请稍后再试」。
   */
  const make = async (retry: boolean): Promise<ArrayBuffer> => {
    const token = await accessToken(db, env.WX_APPID, env.WX_SECRET)
    const res = await fetch(
      `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({
          // scene 上限 32 字符：pollId（~18）+ '-' + 6 位邀请码，放得下
          scene,
          // 落地页统一走 share/join，由它根据 scene 决定是详情还是填写页
          page: 'pages/share/join',
          // 未发布的小程序也能生成、也能扫
          check_path: false,
          env_version: version,
          width: 430,
          auto_color: false,
          is_hyaline: false
        })
      }
    )

    // 成功返回图片二进制，失败返回 application/json
    const type = res.headers.get('content-type') ?? ''
    if (type.includes('json') || type.includes('text')) {
      const err = (await res.json().catch(() => ({}))) as { errcode?: number; errmsg?: string }
      if (retry && (err.errcode === 40001 || err.errcode === 42001)) {
        await resetAccessToken(db)
        return make(false)
      }
      const hint =
        err.errcode === 40001
          ? 'access_token 无效，请检查 AppSecret'
          : err.errmsg || '生成小程序码失败'
      throw new HttpError(502, hint)
    }

    const buf = await res.arrayBuffer()
    if (!buf.byteLength) throw new HttpError(502, '生成小程序码失败')
    return buf
  }

  const buf = await make(true)
  await bucket.put(key, buf, { httpMetadata: { contentType: 'image/png' } })

  return publicUrl(key)
}
