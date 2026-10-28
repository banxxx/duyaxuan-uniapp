/**
 * 统一请求层
 *
 * 职责：拼 baseURL、注入 token、统一解包 { code, data, msg }、
 * 401 静默重登一次、错误 Toast、loading 计数。
 * 业务层只关心 data，不再碰 uni.request。
 *
 * token 通过 auth-token 中转，避免和 user store 互相 import。
 */

import { currentToken, tryRefreshToken } from './auth-token'
import { API_BASE } from './api-base'

export interface ApiResponse<T> {
  code: number
  data: T
  msg?: string
}

export interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: Record<string, any>
  /** 展示全屏 loading */
  loading?: boolean
  /** 失败时是否自动 Toast，默认 true；表单校验类可关掉自己处理 */
  toast?: boolean
  /** 不注入 token（登录接口） */
  skipAuth?: boolean
}

const BASE_URL = API_BASE
const TIMEOUT = 15000

let loadingCount = 0

function showLoading() {
  if (loadingCount === 0) uni.showLoading({ title: '', mask: true })
  loadingCount++
}

function hideLoading() {
  loadingCount = Math.max(0, loadingCount - 1)
  if (loadingCount === 0) uni.hideLoading()
}

export class ApiError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
    this.name = 'ApiError'
  }
}

export async function request<T>(options: RequestOptions): Promise<T> {
  const { url, method = 'GET', data, loading = false, toast = true, skipAuth = false } = options

  if (loading) showLoading()

  try {
    const header: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = currentToken()
    if (!skipAuth && token) header.Authorization = `Bearer ${token}`

    const res = await uni.request({
      url: url.startsWith('http') ? url : `${BASE_URL}${url}`,
      method,
      data,
      header,
      timeout: TIMEOUT
    })

    const status = res.statusCode ?? 0
    const body = res.data as ApiResponse<T> | undefined

    // token 过期：静默重登一次再重试
    if (status === 401 && !skipAuth) {
      const ok = await tryRefreshToken()
      if (ok) return request<T>({ ...options, loading: false })
      throw new ApiError(401, '登录已失效，请重新登录')
    }

    if (status < 200 || status >= 300) {
      throw new ApiError(status, body?.msg || `请求失败（${status}）`)
    }

    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code !== 0) throw new ApiError(body.code, body.msg || '请求失败')
      return body.data
    }

    // 后端直接返回裸数据时也兼容
    return body as unknown as T
  } catch (err) {
    const message = err instanceof ApiError ? err.message : '网络异常，请稍后重试'
    if (toast) uni.showToast({ title: message, icon: 'none' })
    throw err instanceof ApiError ? err : new ApiError(-1, message)
  } finally {
    if (loading) hideLoading()
  }
}

export const http = {
  get<T>(url: string, data?: Record<string, any>, opts?: Partial<RequestOptions>) {
    return request<T>({ url, method: 'GET', data, ...opts })
  },
  post<T>(url: string, data?: Record<string, any>, opts?: Partial<RequestOptions>) {
    return request<T>({ url, method: 'POST', data, ...opts })
  },
  put<T>(url: string, data?: Record<string, any>, opts?: Partial<RequestOptions>) {
    return request<T>({ url, method: 'PUT', data, ...opts })
  },
  del<T>(url: string, data?: Record<string, any>, opts?: Partial<RequestOptions>) {
    return request<T>({ url, method: 'DELETE', data, ...opts })
  }
}
