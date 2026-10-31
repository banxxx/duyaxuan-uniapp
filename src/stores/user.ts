import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { UserProfile } from '@/types/api'
import type { Platform } from '@/utils/platform'
import { loginButtonText } from '@/utils/platform'
import { loginByCode, devLogin, fetchProfile, isMockAuth } from '@/api/auth'
import { registerAuthHooks } from '@/utils/auth-token'
import { ApiError } from '@/utils/request'
import { cacheClear } from '@/utils/cache'
import { ROUTES } from '@/utils/router'

const TOKEN_KEY = 'dyx_token'
const USER_KEY = 'dyx_user'
const PROVIDER_KEY = 'dyx_auth_provider'
const TOKEN_TTL = 1000 * 60 * 60 * 24 * 6 // 后端签发 7 天，前端提前 1 天续

/** H5 扫码登录绑定的平台（设置页解绑时要知道解的是 QQ 还是微信） */
export type AuthProvider = 'qq' | 'weixin'

/**
 * 资料同步的并发闸门。
 *
 * onLaunch、tab 页 onShow、从后台回前台都会触发 refreshProfile，
 * 一次冷启动可能连着调三次。这里只放一个请求出去，后面的直接复用，
 * 免得同一份资料在三秒内拉三遍。
 */
let refreshing: Promise<void> | null = null

/** 本地资料版本号：上传头像/解绑等本地写入会 +1，防止慢请求把新资料覆盖回旧的 */
let profileRevision = 0

interface LoginResult {
  token: string
  user: UserProfile
}

export const useUserStore = defineStore('user', () => {
  const token = ref<string>('')
  const profile = ref<UserProfile | null>(null)
  const platform = ref<Platform>('unknown')
  const loginAt = ref<number>(0)
  /** 仅 H5 扫码登录有值；小程序靠宿主平台判断，不需要这个 */
  const authProvider = ref<AuthProvider | ''>('')

  const isLoggedIn = computed(() => !!token.value)
  const loginText = computed(() => loginButtonText())

  function setPlatform(p: Platform) {
    platform.value = p
  }

  /** 从本地缓存恢复登录态，App.vue onLaunch 调用 */
  function restore() {
    try {
      const t = uni.getStorageSync(TOKEN_KEY)
      const u = uni.getStorageSync(USER_KEY)
      const at = uni.getStorageSync(`${TOKEN_KEY}_at`)
      const p = uni.getStorageSync(PROVIDER_KEY)
      if (t) {
        token.value = t
        // 只有确实有登录态时才认绑定平台，避免退出后残留
        if (p === 'qq' || p === 'weixin') authProvider.value = p
      }
      if (u) profile.value = typeof u === 'string' ? JSON.parse(u) : u
      if (at) loginAt.value = Number(at)
    } catch {
      // 缓存损坏时当作未登录
      logout()
    }
  }

  function persist(result: LoginResult) {
    profileRevision++
    token.value = result.token
    profile.value = result.user
    loginAt.value = Date.now()
    uni.setStorageSync(TOKEN_KEY, result.token)
    uni.setStorageSync(USER_KEY, JSON.stringify(result.user))
    uni.setStorageSync(`${TOKEN_KEY}_at`, String(loginAt.value))
  }

  /**
   * 一键登录
   *
   * 微信 / QQ / 抖音都是「拿 code 换 openid」，区别只在服务端用哪个接口去换。
   * 客户端把 platform 一起发过去，服务端按平台路由：
   *   微信 → jscode2session
   *   QQ   → api.q.qq.com/sns/jscode2session（QQ 复用微信包，所以这里靠运行时 platform 区分）
   *   抖音 → developer.toutiao.com/api/apps/v2/jscode2session
   */
  async function login(): Promise<LoginResult> {
    // H5 没有宿主授权，uni.login 拿不到 code；H5 的登录/续期统一走扫码
    // （见 loginWithMixauth），这里只保留给小程序端。
    if (platform.value === 'h5') throw new Error('请重新扫码登录')

    // mock 模式下后端不存在，也就不需要 code；跳过 uni.login，
    // 这样在没有真实 appid 的游客模式里也能一键进首页。
    let code = 'mock'
    if (!isMockAuth()) {
      // 小程序端不需要 provider（宿主就是登录方），抖音的类型定义里也没有它，
      // 所以只在抖音下补一个 provider，其余平台传空对象。
      const opts: UniApp.LoginOptions = {}
      if (platform.value === 'toutiao') (opts as Record<string, unknown>).provider = 'toutiao'

      // uni.login 在游客模式 / 部分基础库上可能既不回调 success 也不回调 fail，
      // 不给上限的话，401 静默重登会一直挂着，页面停在骨架屏
      const res = await new Promise<UniApp.LoginRes>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('登录超时，请重试')), 10000)
        uni.login({
          ...opts,
          success: (r) => {
            clearTimeout(timer)
            resolve(r)
          },
          fail: (e) => {
            clearTimeout(timer)
            reject(e)
          }
        })
      })
      if (!res.code) throw new Error('未获取到登录凭证')
      code = res.code
    }

    const result = await loginByCode(code)
    persist(result)
    return result
  }

  /**
   * H5 扫码登录成功后落地登录态。
   *
   * token 是 Worker 确认 MixAuth 授权后签发的，这里只负责保存；
   * 记住绑定平台是为了设置页能显示「QQ 授权」并解绑正确的平台。
   */
  function loginWithMixauth(provider: AuthProvider, result: LoginResult) {
    authProvider.value = provider
    uni.setStorageSync(PROVIDER_KEY, provider)
    persist(result)
  }

  /**
   * 开发期切换账号：直接按 userId 登录，不走平台授权。
   * 入口在「设置 · 关于我们」长按，仅 DEV 构建可见。
   */
  async function loginAs(userId: string): Promise<LoginResult> {
    const result = await devLogin(userId)
    persist(result)
    return result
  }

  /** 401 时静默重登一次；失败返回 false */
  async function relogin(): Promise<boolean> {
    if (platform.value === 'h5') {
      // H5 续期必须重新扫码，静默换不到 token。清掉登录态回登录页，
      // 免得用户停在一个所有接口都 401 的页面里反复点。
      logout()
      uni.reLaunch({ url: ROUTES.login })
      return false
    }
    try {
      await login()
      return true
    } catch {
      return false
    }
  }

  function logout() {
    profileRevision++
    token.value = ''
    profile.value = null
    loginAt.value = 0
    authProvider.value = ''
    uni.removeStorageSync(TOKEN_KEY)
    uni.removeStorageSync(USER_KEY)
    uni.removeStorageSync(`${TOKEN_KEY}_at`)
    uni.removeStorageSync(PROVIDER_KEY)
    // 页面数据缓存是按账号内容存的，换人登录不能让他先看到上一个人的投票
    cacheClear()
  }

  /** onShow 时调用：token 快到期的顺延，避免长时间挂起后失效 */
  function touch() {
    if (!token.value) return
    // H5 不能静默续期，提前 1 天把人踢回登录页反而更烦；
    // 让 token 一直用到服务端真的 401，再由 relogin 处理。
    if (platform.value === 'h5') return
    if (Date.now() - loginAt.value > TOKEN_TTL) {
      relogin()
    }
  }

  /** 服务端已经把新资料返回了（解绑等），直接落到本地 */
  function applyProfile(next: UserProfile) {
    profileRevision++
    profile.value = next
    uni.setStorageSync(USER_KEY, JSON.stringify(next))
  }

  /**
   * 和服务端对齐资料，本地缓存只当兜底。
   *
   * 不只在启动时调用：头像/昵称可能在另一台设备上改过，
   * 每次回到首页或「我的」都静默拉一次，跨设备才不会一直显示旧头像。
   */
  async function refreshProfile() {
    if (!token.value) return
    if (refreshing) return refreshing
    const rev = profileRevision
    refreshing = (async () => {
      try {
        const next = await fetchProfile()
        // 请求期间本地刚传过头像/解绑过，就不要再拿旧结果覆盖
        if (rev === profileRevision) applyProfile(next)
      } catch (err) {
        // 服务端已经没有这个账号（换库、在别处注销、被清理）：
        // 本地 token 再留着只会一直拿到 404，还会显示一个指向旧库的头像。
        // 这里直接清掉登录态，下次操作会自动重新登录并建号。
        if (err instanceof ApiError && err.code === 404) logout()
        // 其余错误（网络不好）就先沿用缓存，不阻塞启动
      } finally {
        refreshing = null
      }
    })()
    return refreshing
  }

  // 把读写 token 的能力注册给请求层，打断 store ↔ request 的循环依赖
  registerAuthHooks({
    getToken: () => token.value,
    refresh: relogin
  })

  return {
    token,
    profile,
    platform,
    authProvider,
    isLoggedIn,
    loginText,
    setPlatform,
    restore,
    login,
    loginWithMixauth,
    loginAs,
    relogin,
    logout,
    touch,
    applyProfile,
    refreshProfile
  }
})
