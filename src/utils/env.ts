/**
 * 运行时开关
 *
 * `VITE_USE_MOCK` 是主开关，但光看它会在一个常见场景里坑人：
 * 后端还没写，`.env.production` 里只有占位域名 `api.example.com`，
 * 而 `VITE_USE_MOCK=false` 是给「已经有真后端」准备的。
 * 这时构建出来的包能打开、登录却直接失败，看起来像前端坏了。
 *
 * 所以再加一道兜底：只要 API 域名还是 example.com 占位，
 * 就认为后端不存在，强制走 mock。真接了后端，把域名改掉自然就切回去了。
 */

const ENV = import.meta.env
const BASE_URL = ENV.VITE_API_BASE_URL ?? ''

const PLACEHOLDER_HOST = /(^|\.)example\.(com|org|net)$/i

function isPlaceholderApi(): boolean {
  if (!BASE_URL) return true
  try {
    // 相对路径（/api）说明走同域反代，是真实配置
    if (!/^https?:\/\//i.test(BASE_URL)) return false
    return PLACEHOLDER_HOST.test(new URL(BASE_URL).hostname)
  } catch {
    return false
  }
}

/** 当前是否使用本地假数据 */
export function useMock(): boolean {
  if (isPlaceholderApi()) return true
  return ENV.VITE_USE_MOCK !== 'false'
}
