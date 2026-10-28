import type { UserProfile } from '@/types/api'
import { http } from '@/utils/request'
import { getPlatform } from '@/utils/platform'
import { useMock } from '@/utils/env'
import { API_BASE } from '@/utils/api-base'
import { currentToken } from '@/utils/auth-token'

/**
 * 登录相关接口
 *
 * 开发期走本地假登录，返回一个固定的「林小满」账号，
 * 这样 41 我发起的列表、详情页的发起人视角都能直接演示。
 *
 * 只有平台授权登录这一条路：没有密码、没有短信验证码，
 * 所以这里不再有 changePassword / sendSmsCode / changePhone。
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

/**
 * 拉一次最新资料。
 *
 * 本地缓存的 profile 是登录那一刻的快照，服务端改过（比如清掉头像）就会过期，
 * 启动时静默对齐一次。失败不打扰用户：下次登录或操作时还会再同步。
 */
export async function fetchProfile(): Promise<UserProfile> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 120))
    return { ...MOCK_USER }
  }
  return http.get<UserProfile>('/user/profile', undefined, { toast: false })
}

/** 改昵称。微信昵称也是从这里落库的，不存在「从微信同步」一说 */
export async function updateNickname(nickname: string): Promise<UserProfile> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 200))
    return { ...MOCK_USER, nickname }
  }
  return http.put<UserProfile>('/user/profile', { nickname })
}

/**
 * 上传头像。
 *
 * chooseAvatar 给的是临时文件路径（wxfile:// 或 http://tmp/...），
 * 过一段时间就失效，所以必须立刻传到服务端。
 *
 * 不能走 request.ts：那是 JSON 请求，图片要用 multipart，得用 uni.uploadFile。
 */
export function uploadAvatar(filePath: string): Promise<UserProfile> {
  if (USE_MOCK) {
    return new Promise((resolve) => {
      setTimeout(() => resolve({ ...MOCK_USER, avatar: filePath }), 300)
    })
  }

  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: `${API_BASE}/user/avatar`,
      filePath,
      name: 'file',
      header: { Authorization: `Bearer ${currentToken()}` },
      success: (res) => {
        // uploadFile 不会帮我们解包 { code, data, msg }，得自己来
        try {
          const body = JSON.parse(res.data) as { code: number; data: UserProfile; msg?: string }
          if (res.statusCode === 401) {
            reject(new Error('登录已失效，请重新登录'))
            return
          }
          if (body.code !== 0) {
            reject(new Error(body.msg || '上传失败'))
            return
          }
          resolve(body.data)
        } catch {
          reject(new Error('上传失败，请重试'))
        }
      },
      fail: () => reject(new Error('上传失败，请重试'))
    })
  })
}

/**
 * 注销账号：服务端删除账号及全部数据，前端清本地登录态。
 *
 * 以前要输密码做二次确认，现在登录只依赖平台授权、没有密码可验，
 * 改成由页面弹二次确认框（见 settings/deactivate.vue），这里不再传参。
 */
export async function deleteAccount(): Promise<void> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 300))
    return
  }
  return http.post<void>('/user/deactivate')
}

/** 54 解除微信绑定，返回解除后的资料（bound 变 false） */
export async function unbindWechat(): Promise<UserProfile> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 300))
    return { ...MOCK_USER, bound: false }
  }
  return http.post<UserProfile>('/user/unbind', { platform: getPlatform() })
}
