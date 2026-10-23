import type { UserProfile } from '@/types/api'
import { http } from '@/utils/request'
import { getPlatform } from '@/utils/platform'
import { useMock } from '@/utils/env'

/**
 * 登录相关接口
 *
 * 开发期走本地假登录，返回一个固定的「林小满」账号，
 * 这样 41 我发起的列表、详情页的发起人视角都能直接演示。
 */

const USE_MOCK = useMock()

/**
 * 是否走本地假登录。
 *
 * 导出给 user store 用：假登录根本不需要 code（后端都不存在），
 * 所以打开 mock 时整个跳过 uni.login —— 否则在没有真实 appid 的
 * 游客模式（touristappid）下 uni.login 会直接失败，页面卡在登录页进不去。
 * 这样「npm run dev 打开就能看」不需要任何 appid 配置。
 */
export function isMockAuth(): boolean {
  return USE_MOCK
}

export interface LoginResult {
  token: string
  user: UserProfile
}

const MOCK_USER: UserProfile = {
  id: '1024',
  nickname: '林小满',
  bio: '这个人很懒，什么都没写',
  createdAt: Date.now() - 128 * 24 * 3600 * 1000,
  phone: '138****8888',
  bound: true
}

export async function loginByCode(code: string): Promise<LoginResult> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 260))
    return { token: `mock-token-${Date.now()}`, user: { ...MOCK_USER } }
  }
  return http.post<LoginResult>(
    '/auth/login',
    { platform: getPlatform(), code },
    { skipAuth: true, loading: true }
  )
}

export async function updateProfile(patch: Partial<UserProfile>): Promise<UserProfile> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 200))
    return { ...MOCK_USER, ...patch }
  }
  return http.put<UserProfile>('/user/profile', patch)
}

/** 注销账号：服务端删除账号及全部数据，前端清本地登录态 */
export async function deleteAccount(password: string): Promise<void> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 300))
    return
  }
  return http.post<void>('/user/deactivate', { password })
}

/** 50 修改密码：成功后服务端会作废其他设备的 token */
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 300))
    return
  }
  return http.put<void>('/user/password', { oldPassword, newPassword })
}

/** 51 发送短信验证码，返回倒计时秒数 */
export async function sendSmsCode(phone: string): Promise<{ cooldown: number }> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 200))
    return { cooldown: 60 }
  }
  return http.post<{ cooldown: number }>('/user/sms-code', { phone })
}

/** 51 更换手机号，返回脱敏后的号码 */
export async function changePhone(phone: string, code: string): Promise<{ phone: string }> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 300))
    // 假登录复用同一个账号，把号码改掉，下次进 46 能看到新号
    const masked = `${phone.slice(0, 3)}****${phone.slice(7)}`
    MOCK_USER.phone = masked
    return { phone: masked }
  }
  return http.put<{ phone: string }>('/user/phone', { phone, code })
}

/** 54 解除微信绑定，返回解除后的资料（bound 变 false） */
export async function unbindWechat(): Promise<UserProfile> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 300))
    return { ...MOCK_USER, bound: false }
  }
  return http.post<UserProfile>('/user/unbind', { platform: getPlatform() })
}
