/**
 * 分享页小程序码缓存
 *
 * 小程序码在服务端按 `pollId + 环境 + 样式` 固定命名，地址和图片内容都不会变。
 * 但每次进分享页仍要先请求 /polls/:id/qrcode（Worker → D1 → R2），
 * 再让 <image> 从远端拉一次图，慢网下前后要好几秒。
 *
 * 这里把码图下载到本地文件系统：
 *   - 进页面直接拿本地路径渲染，秒开，不等网络
 *   - 后台再静默问一次地址，只有地址变了（比如 trial → release）才重新下载
 *
 * 为什么不只缓存地址：<image> 的 HTTP 缓存由 WebView 管理，清缓存 / 换版本就没了；
 * 本地文件是应用自己的，跨启动都在。
 */

const KEY_PREFIX = 'shareQr:'

/** 地址多久回源校验一次。码图只在换环境 / 换样式时变，没必要每次进页面都问 */
const RECHECK_MS = 60 * 60 * 1000

export interface QrCacheEntry {
  /** 远端地址：用来判断服务端有没有换过环境 / 样式 */
  url: string
  /** 本地文件路径：<image> 和 canvas 都直接读它 */
  path: string
  /** 上次回源校验的时间戳 */
  checkedAt: number
}

function storageKey(pollId: string): string {
  return `${KEY_PREFIX}${pollId}`
}

export function readQrCache(pollId: string): QrCacheEntry | null {
  if (!pollId) return null
  try {
    const raw = uni.getStorageSync(storageKey(pollId))
    if (!raw) return null
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (
      value &&
      typeof value.url === 'string' &&
      typeof value.path === 'string' &&
      typeof value.checkedAt === 'number'
    ) {
      return value as QrCacheEntry
    }
  } catch {
    // 存储里是脏数据：当没有缓存
  }
  return null
}

export function writeQrCache(pollId: string, entry: QrCacheEntry): void {
  if (!pollId) return
  try {
    uni.setStorageSync(storageKey(pollId), entry)
  } catch {
    // 存储写不进去也不影响本次显示
  }
}

/** 删掉缓存和本地文件：投票被删、本地文件读不出来时调用 */
export function dropQrCache(pollId: string): void {
  if (!pollId) return
  const entry = readQrCache(pollId)
  if (entry?.path) removeSavedFile(entry.path)
  try {
    uni.removeStorageSync(storageKey(pollId))
  } catch {
    // 忽略
  }
}

/** 地址是否该回源校验了 */
export function isQrCacheStale(entry: QrCacheEntry): boolean {
  return Date.now() - entry.checkedAt > RECHECK_MS
}

/**
 * 把远端码图存到本地，返回本地路径；失败返回 null（调用方退回远端地址）。
 *
 * 只有小程序端有可用的文件系统；H5 / 不支持的平台直接返回 null。
 * 保存成功会顺手更新缓存里的地址和校验时间。
 */
export function downloadQrImage(pollId: string, url: string): Promise<string | null> {
  if (!pollId || !url) return Promise.resolve(null)
  if (typeof uni.downloadFile !== 'function' || typeof uni.saveFile !== 'function') {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    uni.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode !== 200 || !res.tempFilePath) {
          resolve(null)
          return
        }
        uni.saveFile({
          tempFilePath: res.tempFilePath,
          success: (saved) => {
            const path = saved.savedFilePath
            if (!path) {
              resolve(null)
              return
            }
            // 这里再读一次：两个下载可能同时在跑（发布成功页 + 分享页），
            // 谁后完成谁负责把对方的文件删掉，避免留下孤儿文件占配额
            const current = readQrCache(pollId)
            writeQrCache(pollId, { url, path, checkedAt: Date.now() })
            if (current?.path && current.path !== path) removeSavedFile(current.path)
            resolve(path)
          },
          fail: () => resolve(null)
        })
      },
      fail: () => resolve(null)
    })
  })
}

function removeSavedFile(filePath: string): void {
  if (typeof uni.removeSavedFile !== 'function') return
  uni.removeSavedFile({ filePath, fail: () => {} })
}
