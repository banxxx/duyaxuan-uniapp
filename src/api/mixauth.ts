import type { UserProfile } from '@/types/api'
import { http } from '@/utils/request'
import { useMock } from '@/utils/env'
import { MOCK_USER } from '@/api/auth'

/**
 * H5 扫码登录 / 绑定（MixAuth）
 *
 * 客户端不直连 MixAuth，也不接触 openid：只拿二维码、轮询状态，
 * 真正的授权校验、建号、绑定都在 Worker 里完成。这样 vercel.app 在境内
 * 不可达也不影响 H5，且前端无法伪造身份。
 */

const USE_MOCK = useMock()

export type MixauthProvider = 'qq' | 'wechat'

export type MixauthState = 'waiting' | 'scanned' | 'denied' | 'expired'

export interface MixauthQr {
  id: string
  /** QQ 是 data:image/png;base64；微信是 open.weixin.qq.com 的图片地址 */
  qrcode: string
}

export interface MixauthStatusResult {
  state: MixauthState | 'success'
  token?: string
  user?: UserProfile
}

export interface BindStatusResult {
  state: MixauthState | 'success'
  /** 绑定不签 token，这里显式留空，让组件里和登录结果共用同一个取值方式 */
  token?: undefined
  user?: UserProfile
}

export function createMixauthQr(provider: MixauthProvider): Promise<MixauthQr> {
  if (USE_MOCK) return Promise.resolve(mockCreateQr(provider))
  return http.post<MixauthQr>(
    '/auth/mixauth/qr',
    { provider },
    { skipAuth: true, toast: false }
  )
}

export async function checkMixauthStatus(
  provider: MixauthProvider,
  id: string
): Promise<MixauthStatusResult> {
  if (USE_MOCK) {
    const state = await mockPoll(id)
    if (state !== 'success') return { state }
    return {
      state: 'success',
      token: `mock-token-${Date.now()}`,
      user: { ...MOCK_USER }
    }
  }
  return http.post<MixauthStatusResult>(
    '/auth/mixauth/status',
    { provider, id },
    { skipAuth: true, toast: false }
  )
}

/** 绑定登录方式：需要登录态，token 由请求层自动带上 */
export function createBindQr(provider: MixauthProvider): Promise<MixauthQr> {
  if (USE_MOCK) return Promise.resolve(mockCreateQr(provider))
  return http.post<MixauthQr>('/user/bind/qr', { provider }, { toast: false })
}

export async function checkBindStatus(
  provider: MixauthProvider,
  id: string
): Promise<BindStatusResult> {
  if (USE_MOCK) {
    const state = await mockPoll(id)
    if (state !== 'success') return { state }
    return { state: 'success', user: { ...MOCK_USER } }
  }
  return http.post<BindStatusResult>('/user/bind/status', { provider, id }, { toast: false })
}

/* ---------------- 仅开发模式使用的假二维码 ---------------- */

const mockPolls = new Map<string, number>()

function mockCreateQr(provider: MixauthProvider): MixauthQr {
  const id = `mock-${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  mockPolls.set(id, 0)
  return { id, qrcode: mockQrImage() }
}

/** 开发模式不连后端：前两次「等待」，第三次「已扫码」，第四次成功 */
async function mockPoll(id: string): Promise<MixauthState | 'success'> {
  await new Promise((r) => setTimeout(r, 120))
  const n = (mockPolls.get(id) ?? 0) + 1
  mockPolls.set(id, n)
  if (n < 2) return 'waiting'
  if (n < 4) return 'scanned'
  mockPolls.delete(id)
  return 'success'
}

/**
 * 画一个像二维码的 25×25 占位图（不可扫）。
 * 只在 mock 模式出现，用来预览弹层布局；真机联调时走真实接口。
 */
function mockQrImage(): string {
  const modules = 25
  const cell = 8
  const size = modules * cell
  const parts: string[] = []

  const finder = (ox: number, oy: number) => {
    parts.push(
      `<rect x="${ox * cell}" y="${oy * cell}" width="${7 * cell}" height="${7 * cell}" fill="#111111"/>`,
      `<rect x="${(ox + 1) * cell}" y="${(oy + 1) * cell}" width="${5 * cell}" height="${5 * cell}" fill="#ffffff"/>`,
      `<rect x="${(ox + 2) * cell}" y="${(oy + 2) * cell}" width="${3 * cell}" height="${3 * cell}" fill="#111111"/>`
    )
  }
  finder(0, 0)
  finder(modules - 7, 0)
  finder(0, modules - 7)

  for (let y = 0; y < modules; y++) {
    for (let x = 0; x < modules; x++) {
      const inFinder =
        (x < 8 && y < 8) || (x > modules - 9 && y < 8) || (x < 8 && y > modules - 9)
      if (inFinder) continue
      if ((x * 3 + y * 5 + ((x * y) % 7)) % 3 === 0) {
        parts.push(
          `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" fill="#111111"/>`
        )
      }
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="100%" height="100%" fill="#ffffff"/>${parts.join('')}</svg>`

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
