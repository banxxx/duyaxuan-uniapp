import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 本地设置
 *
 * 这些开关只影响本机行为（推送、提示），不涉及账号数据，
 * 所以放本地缓存，退出登录也不清——换个人登录，推送设置还是这台手机的。
 *
 * 44 消息通知里的「未读」是服务端状态，不在这里。
 */

const KEY = 'dyx_settings'

export interface Settings {
  /** 总开关（55） */
  pushEnabled: boolean
  /** 55 的四类提醒 */
  pushDeadline: boolean
  pushJoined: boolean
  pushResult: boolean
  pushUpdated: boolean
  /** 缓存大小，显示用 */
  cacheSize: string
}

const DEFAULTS: Settings = {
  pushEnabled: true,
  pushDeadline: true,
  pushJoined: true,
  pushResult: true,
  pushUpdated: false,
  cacheSize: '12.4 MB'
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>({ ...DEFAULTS })

  function restore() {
    try {
      const raw = uni.getStorageSync(KEY)
      if (raw) settings.value = { ...DEFAULTS, ...(typeof raw === 'string' ? JSON.parse(raw) : raw) }
    } catch {
      settings.value = { ...DEFAULTS }
    }
  }

  function persist() {
    uni.setStorageSync(KEY, JSON.stringify(settings.value))
  }

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    settings.value = { ...settings.value, [key]: value }
    persist()
  }

  /** 清缓存：真实实现会算 storageInfo，这里只把展示值归零 */
  function clearCache() {
    try {
      const info = uni.getStorageInfoSync()
      info.keys.forEach((k) => {
        // 保留登录态与设置，其余（图片缓存、草稿）都清掉
        if (!k.startsWith('dyx_token') && !k.startsWith('dyx_user') && k !== KEY) {
          uni.removeStorageSync(k)
        }
      })
    } catch {
      // 拿不到存储信息时忽略
    }
    settings.value = { ...settings.value, cacheSize: '0 MB' }
    persist()
  }

  return { settings, restore, set, clearCache }
})
