/**
 * 平台判定
 *
 * 我们只维护 mp-weixin / mp-toutiao 两个构建目标，QQ 直接跑微信包。
 * 所以「是不是 QQ」不能用条件编译（#ifdef MP-QQ 在微信包里永远为假），
 * 必须运行时判断 —— 全项目只有这一处需要区分。
 */

export type Platform = 'weixin' | 'qq' | 'toutiao' | 'h5' | 'unknown'

interface SystemInfoLike {
  uniPlatform?: string
  platform?: string
  app?: string
  environment?: string
}

let cached: Platform | null = null

export function getPlatform(): Platform {
  if (cached) return cached
  cached = detect()
  return cached
}

function detect(): Platform {
  let info: SystemInfoLike = {}
  try {
    info = uni.getSystemInfoSync() as SystemInfoLike
  } catch {
    return 'unknown'
  }

  // uniPlatform: mp-weixin / mp-qq / mp-toutiao / web ...
  const uniPlatform = info.uniPlatform ?? ''
  if (uniPlatform === 'mp-qq') return 'qq'
  if (uniPlatform === 'mp-weixin') return 'weixin'
  if (uniPlatform === 'mp-toutiao' || uniPlatform === 'mp-lark') return 'toutiao'
  if (uniPlatform === 'web' || uniPlatform === 'h5') return 'h5'

  // 兜底：QQ 小程序宿主里 uniPlatform 会报 mp-weixin，但 app 字段是 QQ
  const app = (info.app ?? '').toLowerCase()
  if (app.includes('qq')) return 'qq'

  const platform = (info.platform ?? '').toLowerCase()
  if (platform === 'devtools') {
    // 开发者工具里无法区分微信/QQ，按微信处理
    return 'weixin'
  }

  return 'unknown'
}

/** 当前宿主是否支持微信生态能力（微信登录、微信分享、微信支付） */
export function isWeixinLike(): boolean {
  return getPlatform() === 'weixin' || getPlatform() === 'qq'
}

/** 登录按钮文案：不同宿主显示不同平台名 */
export function loginButtonText(): string {
  switch (getPlatform()) {
    case 'qq':
      return 'QQ 一键登录'
    case 'toutiao':
      return '抖音一键登录'
    case 'weixin':
      return '微信一键登录'
    default:
      return '一键登录'
  }
}

/** 胶囊按钮位置，用于自定义导航栏对齐 */
export function getMenuButtonRect() {
  try {
    const rect = uni.getMenuButtonBoundingClientRect()
    const info = uni.getSystemInfoSync()
    return {
      top: rect.top,
      height: rect.height,
      // 状态栏高度 + 胶囊高度 + 上下留白 = 自定义导航栏总高
      navHeight: rect.bottom + (rect.top - (info.statusBarHeight ?? 20))
    }
  } catch {
    return { top: 44, height: 32, navHeight: 88 }
  }
}

/**
 * 安全区：设计稿的「状态栏 + 胶囊」在真机上由系统绘制，
 * 页面只需要按这个结果让位，不能靠 env(safe-area-inset-top)——
 * 微信小程序里它只有刘海高度，不包含胶囊，右上角的按钮会被盖住。
 */
export interface SafeArea {
  statusBarHeight: number
  /** 没有导航栏的页面（02 首页 / 40 我的）内容从哪里开始 */
  contentTop: number
  /** 导航栏右侧要给胶囊让出的宽度 */
  capsuleInset: number
  /** 底部小横条（home indicator）占掉的高度，单位 px */
  safeBottom: number
}

let safeArea: SafeArea | null = null

export function getSafeArea(): SafeArea {
  if (safeArea) return safeArea

  let statusBarHeight = 20
  let windowWidth = 375
  let safeBottom = 0
  try {
    const info = uni.getSystemInfoSync() as Record<string, any>
    statusBarHeight = info.statusBarHeight ?? 20
    windowWidth = info.windowWidth ?? 375
    // 底部安全区：微信/QQ 用 safeAreaInsets，抖音等老接口用 safeArea 反推
    const insets = info.safeAreaInsets
    if (insets && typeof insets.bottom === 'number') {
      safeBottom = insets.bottom
    } else if (info.safeArea && typeof info.windowHeight === 'number') {
      safeBottom = Math.max(0, info.windowHeight - info.safeArea.bottom)
    }
  } catch {
    /* 取不到就用兜底值 */
  }

  let capsule: { left: number; bottom: number; height: number } | null = null
  try {
    const rect = uni.getMenuButtonBoundingClientRect()
    // 部分平台（H5 / 老版本开发者工具）会返回全 0，视为没有胶囊
    if (rect && rect.left > 0 && rect.height > 0) {
      capsule = { left: rect.left, bottom: rect.bottom, height: rect.height }
    }
  } catch {
    capsule = null
  }

  safeArea = {
    statusBarHeight,
    // 有胶囊时内容要整体落到胶囊下沿再留 8，否则右上角第一排控件会被盖住
    contentTop: capsule ? Math.max(statusBarHeight + 8, capsule.bottom + 8) : statusBarHeight + 8,
    capsuleInset: capsule ? Math.max(0, windowWidth - capsule.left + 8) : 0,
    safeBottom
  }
  return safeArea
}

/**
 * 底部操作栏/固定栏的下边距：设计稿固定留 20，再叠加真机底部小横条。
 * 返回内联 style 用的字符串，单位 px —— env(safe-area-inset-bottom) 在
 * 微信开发者工具里经常是 0，真机上又不可预测，所以改用 getSystemInfoSync
 * 量出的 safeAreaInsets.bottom，稳定且跨平台一致。
 */
export function bottomInset(base = 20): string {
  return `${base + getSafeArea().safeBottom}px`
}
