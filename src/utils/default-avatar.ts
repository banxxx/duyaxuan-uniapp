import DEFAULT_AVATARS from 'virtual:default-avatars'

/**
 * 默认头像
 *
 * 用户没上传头像时，从 src/static/avatars/ 里挑一张，而不是显示一个纯色首字。
 *
 * 换图：把文件丢进 src/static/avatars/ 就行，png / jpg / webp / gif 都可以，
 * 文件名随意、数量随意，不用改代码。清单由 vite.config.ts 的
 * dyx:default-avatars 插件在构建时扫目录生成（虚拟模块 virtual:default-avatars），
 * 因为小程序运行时读不到目录，打包也只会带上静态引用到的文件。
 *
 * 注意：新增图片后要重启 npm run dev:mp-weixin —— 运行中的构建不会把
 * 新出现的静态文件拷进 dist。
 */

/**
 * 按 seed 稳定地挑一张。
 *
 * 必须稳定：如果每次渲染都随机，列表滚动、页面切换时同一个人的头像会
 * 变来变去，看起来像加载错了。
 * seed 用用户 id 而不是昵称 —— 改了昵称头像不该跟着换。
 *
 * 目录为空时返回空串，AppAvatar 会退回昵称首字。
 */
export function pickDefaultAvatar(seed?: string): string {
  if (!DEFAULT_AVATARS.length) return ''
  if (!seed) return DEFAULT_AVATARS[0]

  // 32 位 FNV 变体，够散且不会溢出
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0
  }
  return DEFAULT_AVATARS[h % DEFAULT_AVATARS.length]
}
