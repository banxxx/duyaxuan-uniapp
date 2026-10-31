/**
 * MixAuth 扫码登录（QQ / 微信）
 *
 * MixAuth 是一个自部署的扫码登录服务，只提供三个接口：
 *   POST /api/qr     { type }      → { data: { id, qrcode } }
 *   POST /api/status { type, id }  → { data: 状态, signData }
 *   POST /api/verify { sign }      → 校验 signData（iframe 方式才需要）
 *
 * H5 端只认我们自己的 Worker，由 Worker 在这里直接问 MixAuth：
 *   1. 客户端拿不到任何 openid，身份只由服务端确认；
 *   2. 境内直连 vercel.app 会被 DNS 污染，Worker 的出口不受影响。
 *
 * 注意：/api/status 返回的 data 是「轮询那一刻的状态」，不能当作用户凭证
 * 传给客户端再让客户端换 token —— 那样等于让前端自报身份。
 */

import type { Env } from '../types'
import { HttpError } from './response'

export type MixauthProvider = 'qq' | 'wechat'

export type MixauthState = 'waiting' | 'scanned' | 'denied' | 'expired'

export type MixauthStatus =
  | { state: MixauthState }
  | { state: 'success'; openid: string; nickname?: string }

/** 登录 / 绑定两个路由共用：只认 qq 和 wechat，其余一律 400 */
export function readMixauthProvider(value: unknown): MixauthProvider {
  if (value === 'qq' || value === 'wechat') return value
  throw new HttpError(400, '不支持的登录方式')
}

/** 没配 MIXAUTH_BASE_URL 时的默认值，对应 /server/wrangler.toml 里的同一项 */
const DEFAULT_BASE_URL = 'https://mixauth-one.vercel.app'

/** MixAuth 拉二维码、轮询腾讯都要走公网，8 秒足够；超时就当服务不可用 */
const TIMEOUT_MS = 8000

/** 二维码 id 是 AES 串（微信）或 qrsig（QQ），这里只做防脏数据的上限 */
const MAX_ID_LENGTH = 4096

function baseUrl(env: Env): string {
  return (env.MIXAUTH_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

async function post<T>(env: Env, path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${baseUrl(env)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (err) {
    console.error('[mixauth] request failed', path, err)
    throw new HttpError(502, '登录服务暂时不可用，请稍后再试')
  }

  if (!res.ok) {
    // MixAuth 参数错误时返回 400 + {error}；这里不把它的原文透给客户端
    console.error('[mixauth] bad response', path, res.status, await res.text().catch(() => ''))
    throw new HttpError(502, '登录服务暂时不可用，请稍后再试')
  }

  try {
    return (await res.json()) as T
  } catch {
    throw new HttpError(502, '登录服务返回异常，请稍后再试')
  }
}

interface QrResponse {
  success?: boolean
  data?: { id?: unknown; qrcode?: unknown }
}

/**
 * 生成登录二维码。
 * QQ 的 qrcode 是 data:image/png;base64,...；微信是 open.weixin.qq.com 的图片地址。
 */
export async function createMixauthQr(
  env: Env,
  provider: MixauthProvider
): Promise<{ id: string; qrcode: string }> {
  const body = await post<QrResponse>(env, '/api/qr', { type: provider })
  const id = body?.data?.id
  const qrcode = body?.data?.qrcode

  if (
    !body?.success ||
    typeof id !== 'string' ||
    !id ||
    id.length > MAX_ID_LENGTH ||
    typeof qrcode !== 'string' ||
    !qrcode
  ) {
    throw new HttpError(502, '二维码生成失败，请重试')
  }

  return { id, qrcode }
}

interface StatusResponse {
  success?: boolean
  data?: Record<string, unknown>
}

/**
 * 查询一次扫码状态。
 *
 * 只有 MixAuth 明确返回「已授权」时才给出 openid；其余状态原样归一化，
 * 客户端只能拿去显示文案，不能据此登录。
 */
export async function checkMixauthStatus(
  env: Env,
  provider: MixauthProvider,
  id: string
): Promise<MixauthStatus> {
  const body = await post<StatusResponse>(env, '/api/status', { type: provider, id })
  const data = body?.data

  if (!body?.success || !data || typeof data !== 'object') {
    throw new HttpError(502, '登录状态查询失败，请重试')
  }

  return provider === 'qq' ? parseQqStatus(data) : parseWechatStatus(data)
}

function parseQqStatus(data: Record<string, unknown>): MixauthStatus {
  const code = String(data.code ?? '')

  if (code === '0') {
    // parsePtuiCB 只有拿到 redirect 且取到 uin 时才置 success/qq
    if (data.success === true && typeof data.qq === 'string' && data.qq) {
      return {
        state: 'success',
        openid: `mixauth:${data.qq}`,
        nickname: cleanNickname(data.username)
      }
    }
    return { state: 'waiting' }
  }

  switch (code) {
    case '65':
      return { state: 'expired' }
    case '68':
      return { state: 'denied' }
    case '67':
      return { state: 'scanned' }
    default:
      return { state: 'waiting' }
  }
}

function parseWechatStatus(data: Record<string, unknown>): MixauthStatus {
  // 授权成功：{ success: true, data: { Data: { UserIdStr, NickName, HeaderImg } } }
  const payload = data.data as { Data?: Record<string, unknown> } | undefined
  const userId = payload?.Data?.UserIdStr
  if (data.success === true && typeof userId === 'string' && userId) {
    return {
      state: 'success',
      openid: `mixauth:${userId}`,
      nickname: cleanNickname(payload?.Data?.NickName)
    }
  }

  // 未完成：{ wx_errcode: 404 已扫 / 403 拒绝 / 408 过期 }
  const errcode = Number(data.wx_errcode)
  if (errcode === 404) return { state: 'scanned' }
  if (errcode === 403) return { state: 'denied' }
  if (errcode === 408) return { state: 'expired' }
  return { state: 'waiting' }
}

/** 昵称只在首次建号时用；QQ 的昵称可能是 URL 编码的 */
function cleanNickname(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  let name = value
  if (/%[0-9A-Fa-f]{2}/.test(name)) {
    try {
      name = decodeURIComponent(name)
    } catch {
      // 编码坏了就按原文用
    }
  }
  name = name.trim().slice(0, 20)
  return name || undefined
}
