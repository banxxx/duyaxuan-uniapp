/**
 * Tab 页导航
 *
 * 「发现」「我的」在 pages.json 里声明成了 tabBar 页（tabBar.custom = true，
 * 原生那条栏不渲染，视觉栏由 AppTabBar 组件画）。
 *
 * 为什么一定要走 tab 页 + switchTab：
 *   reLaunch 会销毁当前页、重建目标页 —— 用户看到的就是整页白闪一下，
 *   而且目标页的骨架屏会重新出现。switchTab 复用已存在的页面实例，切换是瞬时的。
 */

function normalize(pagePath: string): string {
  return `/${pagePath.replace(/^\//, '')}`
}

/** 切到某个 tab 页（pagePath 不带 query） */
export function switchTab(pagePath: string): void {
  uni.switchTab({
    url: normalize(pagePath),
    fail: () => {
      // 兜底：万一页面没进 tabBar.list，退回 reLaunch，保证不卡住
      uni.reLaunch({ url: normalize(pagePath) })
    }
  })
}

export const TAB_HOME = 'pages/index/index'
export const TAB_ME = 'pages/me/index'

/**
 * 藏掉平台自带的 tabBar。
 *
 * 微信端 tabBar.custom = true，原生栏根本不渲染，这里会走 fail —— 正常。
 * H5 端不支持 custom，会渲染一条原生栏，必须藏掉，否则和我们自己的 AppTabBar 重叠。
 */
export function hideNativeTabBar(): void {
  uni.hideTabBar({
    animation: false,
    fail: () => {
      /* 没有原生 tabBar 时（微信 custom / 未声明）忽略 */
    }
  })
}
