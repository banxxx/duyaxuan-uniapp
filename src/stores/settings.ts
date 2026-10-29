import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useDraftStore } from './draft'
import { cacheClear } from '@/utils/cache'

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

/**
 * 「缓存」到底指什么
 *
 * 以前这里直接拿 uni.getStorageInfoSync().currentSize 当缓存大小，
 * 但那是整个本地存储的占用——包含 token、用户资料、本页设置这些
 * 清不掉也不该清的东西。结果就是：点了清除，展示值几乎不变，
 * 看起来像没清干净。
 *
 * 现在改成白名单：只统计、只清除下面这些「丢了也能重新拿到」的数据。
 * 登录态（dyx_token / dyx_user）和设置（dyx_settings）永远不在这份名单里。
 */
const CACHE_KEYS = ['dyx_draft', 'dyx_search_history']
const CACHE_PREFIXES = ['dyx_platform_nick_']

function isCacheKey(key: string): boolean {
  return CACHE_KEYS.includes(key) || CACHE_PREFIXES.some((p) => key.startsWith(p))
}

/** 字符串按 UTF-8 估算字节数：中文一个字 3 字节，不能直接用 length */
function utf8Bytes(value: string): number {
  let bytes = 0
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      // 代理对算一个 4 字节字符
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 KB'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

/** 某个 key 在本地占的字节数（拿不到就按 0 算） */
function keyBytes(key: string): number {
  try {
    const value = uni.getStorageSync(key)
    if (typeof value === 'string') return utf8Bytes(value)
    if (value === null || value === undefined || value === '') return 0
    return utf8Bytes(JSON.stringify(value))
  } catch {
    return 0
  }
}

/** 只统计可清理的那部分，不含登录态和设置 */
function readCacheSize(): string {
  try {
    const keys = uni.getStorageInfoSync().keys ?? []
    const bytes = keys.filter(isCacheKey).reduce((sum, key) => sum + keyBytes(key), 0)
    return formatSize(bytes)
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

  /**
   * 清缓存：只删白名单里的 key，返回清掉的大小（用于 toast）
   *
   * 登录态、用户资料、本页设置都不动 —— 清完还应该是登录状态。
   * 内存里的详情缓存也一起丢掉，否则「清了缓存」再进详情还是旧数据。
   */
  function clearCache(): string {
    let removed = 0
    try {
      const keys = uni.getStorageInfoSync().keys ?? []
      keys.filter(isCacheKey).forEach((k) => {
        removed += keyBytes(k)
        uni.removeStorageSync(k)
      })
    } catch {
      // 拿不到存储信息时忽略，展示值仍然会重算
    }

    try {
      // 草稿在内存里还有一份，只删存储的话下次 patch 又会写回去
      useDraftStore().reset()
    } catch {
      // store 还没初始化时忽略
    }

    // 页面数据缓存也在内存里，不清的话「清了缓存」再进详情还是旧内容
    cacheClear()

    settings.value = { ...settings.value, cacheSize: readCacheSize() }
    persist()
    return formatSize(removed)
  }

  return { settings, restore, set, clearCache }
})
