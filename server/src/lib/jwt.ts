/**
 * JWT（HS256）
 *
 * 小程序端不需要刷新接口：token 过期时 request.ts 收到 401 会重新
 * uni.login 换 code 再调 /auth/login，拿到的就是新 token。
 * 所以这里只需要签 / 验，不需要 refresh。
 *
 * 用 WebCrypto 而不是 jsonwebtoken：Worker 里没有 Node 的 crypto，
 * 而且少一个依赖就少一份冷启动开销。
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

export interface TokenPayload {
  /** 用户 id */
  sub: string
  iat: number
  exp: number
}

function b64urlFromBytes(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function bytesFromB64url(str: string): Uint8Array {
  const pad = '='.repeat((4 - (str.length % 4)) % 4)
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

export async function signToken(sub: string, secret: string, ttlSeconds: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64urlFromBytes(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64urlFromBytes(enc.encode(JSON.stringify({ sub, iat: now, exp: now + ttlSeconds })))
  const data = `${header}.${body}`
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data))
  return `${data}.${b64urlFromBytes(new Uint8Array(sig))}`
}

/** 验签 + 过期检查。任何一步不过都返回 null，调用方统一回 401 */
export async function verifyToken(token: string, secret: string): Promise<TokenPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, b, s] = parts

  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      bytesFromB64url(s),
      enc.encode(`${h}.${b}`)
    )
    if (!valid) return null

    const payload = JSON.parse(dec.decode(bytesFromB64url(b))) as TokenPayload
    if (typeof payload.sub !== 'string' || !payload.sub) return null
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null
    return payload
  } catch {
    // 签名段不是合法 base64、body 不是合法 JSON —— 都是伪造的 token
    return null
  }
}
