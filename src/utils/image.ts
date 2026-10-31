/**
 * 选项配图：选图 + 压缩
 *
 * 只负责把「用户相册里的一张图」变成一个体积可控的本地临时路径，
 * 上传和存储地址在 api/poll.ts 里（uploadPollImage）。
 */

/** 一个选项最多几张图，和后端 MAX_OPTION_IMAGES 保持一致 */
export const MAX_OPTION_IMAGES = 3

/** 压缩后的最长边。作品截图在详情页最多显示 64 宽，1280 已经够点开看大图 */
const MAX_WIDTH = 1280
const QUALITY = 80

/**
 * 选一张图，返回本地临时路径；用户取消返回 null。
 *
 * sizeType 用 compressed：微信会先自己压一道，大图在弱网下也能传得动。
 * 但它的压缩不看尺寸，长截图仍然可能有一两 MB，所以再用 compressImage
 * 限一下宽度 —— 不支持这个 API 的平台（H5）直接用原图。
 */
export function chooseImage(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    uni.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const path = res.tempFilePaths?.[0]
        if (!path) return resolve(null)
        resolve(shrink(path))
      },
      fail: (err) => {
        // 用户主动取消不是错误，不要弹「选择图片失败」
        if (/cancel/i.test(err?.errMsg ?? '')) return resolve(null)
        reject(new Error('选择图片失败'))
      }
    })
  })
}

/**
 * 压缩。失败就返回原图 —— 压缩是优化，不该让用户选不了图。
 */
function shrink(src: string): Promise<string> {
  const compressImage = (uni as any).compressImage
  if (typeof compressImage !== 'function') return Promise.resolve(src)

  return new Promise((resolve) => {
    compressImage({
      src,
      quality: QUALITY,
      compressedWidth: MAX_WIDTH,
      success: (res: { tempFilePath?: string }) => resolve(res?.tempFilePath || src),
      fail: () => resolve(src)
    })
  })
}
