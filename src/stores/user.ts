import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { UserProfile } from '@/types/api'
import type { Platform } from '@/utils/platform'
import { loginButtonText } from '@/utils/platform'
import { loginByCode, fetchProfile, isMockAuth } from '@/api/auth'
import { registerAuthHooks } from '@/utils/auth-token'

const TOKEN_KEY = 'dyx_token'
const USER_KEY = 'dyx_user'
const TOKEN_TTL = 1000 * 60 * 60 * 24 * 6 // 后端签发 7 天，前端提前 1 天续

interface LoginResult {
  token: string
  user: UserProfile
}

export const useUserStore = defineStore('user', () => {
  const token = ref<string>('')
  const profile = ref<UserProfile | null>(null)
  const platform = ref<Platform>('unknown')
  const loginAt = ref<number>(0)

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
      if (t) token.value = t
      if (u) profile.value = typeof u === 'string' ? JSON.parse(u) : u
      if (at) loginAt.value = Number(at)
    } catch {
      // 缓存损坏时当作未登录
      logout()
    }
  }

  function persist(result: LoginResult) {
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
    // mock 模式下后端不存在，也就不需要 code；跳过 uni.login，
    // 这样在没有真实 appid 的游客模式里也能一键进首页。
    let code = 'mock'
    if (!isMockAuth()) {
      // 小程序端不需要 provider（宿主就是登录方），抖音的类型定义里也没有它，
      // 所以只在抖音下补一个 provider，其余平台传空对象。
      const opts: UniApp.LoginOptions = {}
      if (platform.value === 'toutiao') (opts as Record<string, unknown>).provider = 'toutiao'

      const res = await new Promise<UniApp.LoginRes>((resolve, reject) => {
        uni.login({ ...opts, success: resolve, fail: reject })
      })
      if (!res.code) throw new Error('未获取到登录凭证')
      code = res.code
    }

    const result = await loginByCode(code)
    persist(result)
    return result
  }

  /** 401 时静默重登一次；失败返回 false */
  async function relogin(): Promise<boolean> {
    try {
      await login()
      return true
    } catch {
      return false
    }
  }

  function logout() {
    token.value = ''
    profile.value = null
    loginAt.value = 0
    uni.removeStorageSync(TOKEN_KEY)
    uni.removeStorageSync(USER_KEY)
    uni.removeStorageSync(`${TOKEN_KEY}_at`)
  }

  /** onShow 时调用：token 快到期的顺延，避免长时间挂起后失效 */
  function touch() {
    if (!token.value) return
    if (Date.now() - loginAt.value > TOKEN_TTL) {
      relogin()
    }
  }

  /** 服务端已经把新资料返回了（解绑等），直接落到本地 */
  function applyProfile(next: UserProfile) {
    profile.value = next
    uni.setStorageSync(USER_KEY, JSON.stringify(next))
  }

  /** 启动时和服务端对齐一次资料，本地缓存只当兜底 */
  async function refreshProfile() {
    if (!token.value) return
    try {
      applyProfile(await fetchProfile())
    } catch {
      // 网络不好就先用缓存，不阻塞启动
    }
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
    isLoggedIn,
    loginText,
    setPlatform,
    restore,
    login,
    relogin,
    logout,
    touch,
    applyProfile,
    refreshProfile
  }
})
