/**
 * 接口域名
 *
 * 单独抽出来，是为了让 AppAvatar 这种基础组件也能拼图片地址，
 * 而不用 import 整个 request.ts（那会连带把 auth-token、uni.request
 * 的初始化拉进每一个用到头像的地方）。
 */

const RAW = import.meta.env.VITE_API_BASE_URL ?? ''

/** 去掉结尾斜杠，避免拼出 `//polls` */
export const API_BASE = (RAW || 'https://api.example.com').replace(/\/+$/, '')

/** 已经是完整地址（http / 本地临时文件 / base64）就不动它 */
const ABSOLUTE = /^(https?:|wxfile:|file:|data:|blob:|\/\/)/i

/**
 * 后端存的是相对路径（/files/avatars/xxx.jpg），因为域名可能会换
 * （本地 127.0.0.1 → 线上域名）。渲染时在这里补全。
 */
export function resolveFileUrl(src?: string): string {
  if (!src) return ''
  if (ABSOLUTE.test(src)) return src
  return src.startsWith('/') ? `${API_BASE}${src}` : src
}
