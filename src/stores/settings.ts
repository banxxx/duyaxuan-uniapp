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
  /** 55 的几类提醒 */
  pushDeadline: boolean
  pushJoined: boolean
  /** 新的评论 / 回复（服务端按 comment 模板推） */
  pushComment: boolean
  pushResult: boolean
  pushUpdated: boolean
  /** 缓存大小，显示用（每次 restore 都按真实存储占用重算，不存死值） */
  cacheSize: string
}

/** 本地存储实际占了多少，uni.getStorageInfoSync().currentSize 单位是 KB */
function readCacheSize(): string {
  try {
    const kb = uni.getStorageInfoSync().currentSize
    if (!kb) return '0 KB'
    return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`
  } catch {
    return '0 KB'
  }
}

const DEFAULTS: Settings = {
  pushEnabled: true,
  pushDeadline: true,
  pushJoined: true,
  pushComment: true,
  pushResult: true,
  pushUpdated: false,
  cacheSize: '0 KB'
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
    // 存储占用是会变的，不能沿用上次存的展示值
    settings.value = { ...settings.value, cacheSize: readCacheSize() }
  }

  function persist() {
    uni.setStorageSync(KEY, JSON.stringify(settings.value))
  }

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    settings.value = { ...settings.value, [key]: value }
    persist()
  }

  /** 清缓存：清掉除登录态和设置以外的 key，然后把展示值按真实占用重算 */
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
    settings.value = { ...settings.value, cacheSize: readCacheSize() }
    persist()
  }

  return { settings, restore, set, clearCache }
})
