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

export const AVATAR_PREFIX = 'avatars/'
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024

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
 * 只允许读头像目录。
 *
 * R2 的键是扁平的，没有路径穿越问题，但放行任意键等于把整个桶
 * 公开出去 —— 以后要是往里存别的东西（导出文件等），这个白名单就是边界。
 */
export function isPublicKey(key: string): boolean {
  return key.startsWith(AVATAR_PREFIX) && !key.includes('..')
}

/** 存进 users.avatar 的相对路径，前端拿 API 域名拼成完整地址 */
export function publicUrl(key: string): string {
  return `/files/${key}`
}

/** 反过来：把存下来的相对路径还原成 R2 键 */
export function keyFromPublicUrl(url: string): string | null {
  return url.startsWith('/files/') ? url.slice('/files/'.length) : null
}
