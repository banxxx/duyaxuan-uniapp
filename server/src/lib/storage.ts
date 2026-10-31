/**
 * R2 对象键规则
 *
 * 头像按用户分目录：avatars/<userId>/<时间戳>.<ext>
 * 时间戳让每次上传都是新键，浏览器/小程序缓存不会串图；
 * 换头像时顺手把旧键删掉，R2 里不会一直堆。
 */

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif'
}

/**
 * 对外提供的 MIME 只由扩展名决定，不信上传时客户端给的 Content-Type。
 * 否则把 .jpg 文件的 type 写成 text/html，读文件时就会按 HTML 执行。
 */
export function mimeByExt(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream'
}

/** /files/* 只放头像和小程序码，统一按图片类型返回 */
export function publicFileMime(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1)
  return mimeByExt(ext)
}

export const AVATAR_PREFIX = 'avatars/'
/** 小程序码按 pollId + 环境存，生成一次就复用 */
export const QRCODE_PREFIX = 'qrcodes/'
/**
 * 图文投票的选项配图。
 *
 * 按用户分目录而不是按 pollId：选项是在创建流程里先传图、再发布投票，
 * 上传那一刻还没有 pollId。代价是放弃创建的草稿会留下孤儿文件，
 * 和头像上传失败时一样 —— 量很小，不做清理。
 */
export const OPTION_PREFIX = 'options/'
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024
/** 选项图比头像宽松：作品截图经常更宽更长，客户端会先压到 1MB 以内 */
export const MAX_OPTION_IMAGE_BYTES = 5 * 1024 * 1024
/** 一个选项最多几张图，和后端 cleanOptions / 前端图位数量保持一致 */
export const MAX_OPTION_IMAGES = 3

/** 从 MIME 或文件名推断扩展名，不是图片返回 null */
export function imageExt(type: string, name?: string): string | null {
  const mime = (type || '').split(';')[0].trim().toLowerCase()
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime]

  // 部分机型上传时 type 是空串，退回看文件名
  const m = /\.(jpe?g|png|webp|gif)$/i.exec(name ?? '')
  if (!m) return null
  const ext = m[1].toLowerCase()
  return ext === 'jpeg' ? 'jpg' : ext
}

export function avatarKey(userId: string, ext: string): string {
  return `${AVATAR_PREFIX}${userId}/${Date.now()}.${ext}`
}

/**
 * 选项图的对象键。
 *
 * 同一毫秒连传两张时纯时间戳会撞键，加上随机后缀：
 * 键撞了后者会覆盖前者，用户看到的就是「传了 3 张只剩 2 张」。
 */
export function optionImageKey(userId: string, ext: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${OPTION_PREFIX}${userId}/${Date.now()}-${rand}.${ext}`
}

/**
 * 只允许读头像、小程序码、选项配图三个目录。
 *
 * R2 的键是扁平的，没有路径穿越问题，但放行任意键等于把整个桶
 * 公开出去 —— 以后要是往里存别的东西（导出文件等），这个白名单就是边界。
 */
export function isPublicKey(key: string): boolean {
  if (key.includes('..')) return false
  return (
    key.startsWith(AVATAR_PREFIX) ||
    key.startsWith(QRCODE_PREFIX) ||
    key.startsWith(OPTION_PREFIX)
  )
}

/**
 * 校验前端传回来的选项图地址。
 *
 * 只认本服务 `/files/options/...` 这一种形态：允许任意字符串等于让客户端
 * 把外站地址写进数据库，详情页就会替别人的域名拉图（还会绕过微信的域名白名单）。
 */
export function isOptionImageUrl(url: string): boolean {
  if (!url.startsWith('/files/')) return false
  const key = keyFromPublicUrl(url)
  return !!key && key.startsWith(OPTION_PREFIX) && !key.includes('..')
}

/** 存进 users.avatar 的相对路径，前端拿 API 域名拼成完整地址 */
export function publicUrl(key: string): string {
  return `/files/${key}`
}

/** 反过来：把存下来的相对路径还原成 R2 键 */
export function keyFromPublicUrl(url: string): string | null {
  return url.startsWith('/files/') ? url.slice('/files/'.length) : null
}
