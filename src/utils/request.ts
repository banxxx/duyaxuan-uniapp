/**
 * 统一请求层
 *
 * 职责：拼 baseURL、注入 token、统一解包 { code, data, msg }、
 * 401 静默重登一次、错误 Toast。
 * 业务层只关心 data，不再碰 uni.request。
 *
 * 这里故意不提供全屏 loading：uni.showLoading 是微信原生的黑色遮罩，
 * 和项目视觉完全不是一套，而且后台静默重登时突然盖住整屏很突兀。
 * 需要等待反馈的页面用自己的按钮 loading / 骨架屏。
 *
 * token 通过 auth-token 中转，避免和 user store 互相 import。
 */

import { currentToken, tryRefreshToken } from './auth-token'
import { API_BASE } from './api-base'
// 请求层只负责「说什么」，怎么显示交给 AppToast（别名避免和 options.toast 重名）
import { toast as appToast } from './toast'

export interface ApiResponse<T> {
  code: number
  data: T
  msg?: string
}

export interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: Record<string, any>
  /** 失败时是否自动 Toast，默认 true；表单校验类可关掉自己处理 */
  toast?: boolean
  /** 不注入 token（登录接口） */
  skipAuth?: boolean
  /** 自定义超时（毫秒）；默认用 TIMEOUT，个别慢接口（如生成小程序码）可以放宽 */
  timeout?: number
  /** 内部使用：401 后已经重登重试过一次，避免 token 持续失效时无限重试 */
  retried?: boolean
}

const BASE_URL = API_BASE

/**
 * 请求硬超时。
 *
 * `uni.request` 自带的 timeout 依赖平台实现：真机在 DNS 解析 / TLS 握手卡住时，
 * 底层可能迟迟不回调，页面就一直停在骨架屏。这里再加一道 JS 定时器兜底，
 * 到点直接 abort 并 reject，保证任何请求都会在有限时间内结束。
 *
 * 12s：够覆盖 Worker 冷启动 + 慢网，又不至于让用户盯着骨架屏太久。
 */
const TIMEOUT = 12000

export class ApiError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
    this.name = 'ApiError'
  }
}

/** 给可能卡住的异步操作（如 uni.login）加个上限，超时按失败处理 */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      resolve(fallback)
    }, ms)
    p.then(
      (v) => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(v)
      },
      () => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(fallback)
      }
    )
  })
}

/**
 * 发一次请求，并保证在 TIMEOUT 内一定 settle。
 *
 * 用回调形式而不是 Promise 形式，是为了拿到 RequestTask 以便超时后 abort：
 * 不中断的话，慢请求会在后台继续跑，回包时再触发一次无主的状态更新。
 */
function send(
  options: {
    url: string
    method: 'GET' | 'POST' | 'PUT' | 'DELETE'
    data?: Record<string, any>
    header: Record<string, string>
  },
  timeout = TIMEOUT
): Promise<UniApp.RequestSuccessCallbackResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    let task: UniApp.RequestTask | undefined

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      finish(() => {
        task?.abort()
        reject(new ApiError(-1, '请求超时，请检查网络后重试'))
      })
    }, timeout)

    task = uni.request({
      ...options,
      timeout,
      success: (r) => finish(() => resolve(r)),
      fail: () => finish(() => reject(new ApiError(-1, '网络异常，请检查网络后重试')))
    })
  })
}

export async function request<T>(options: RequestOptions): Promise<T> {
  const {
    url,
    method = 'GET',
    data,
    toast = true,
    skipAuth = false,
    timeout = TIMEOUT,
    retried = false
  } = options

  try {
    const header: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = currentToken()
    if (!skipAuth && token) header.Authorization = `Bearer ${token}`

    const res = await send(
      {
        url: url.startsWith('http') ? url : `${BASE_URL}${url}`,
        method,
        data,
        header
      },
      timeout
    )

    const status = res.statusCode ?? 0
    const body = res.data as ApiResponse<T> | undefined

    // token 过期：静默重登一次再重试。只重试一次 —— 如果换了新 token 仍然 401，
    // 再重试就会变成无限循环，页面永远等不到结果（骨架屏卡死、超时也不会触发）
    if (status === 401 && !skipAuth) {
      if (retried) throw new ApiError(401, '登录已失效，请重新登录')
      // uni.login 在部分环境可能不回调，重登也要有上限，否则整条请求会一直挂着
      const ok = await withTimeout(tryRefreshToken(), timeout, false)
      if (ok) return request<T>({ ...options, retried: true })
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
    if (toast) appToast.error(message)
    throw err instanceof ApiError ? err : new ApiError(-1, message)
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
