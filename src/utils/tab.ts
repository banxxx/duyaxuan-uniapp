/**
 * Tab 页导航
 *
 * 「发现」「我的」在 pages.json 里声明成了 tabBar 页（tabBar.custom = true，
 * 原生那条栏不渲染，视觉栏由 AppTabBar 组件画）。
 *
 * 为什么一定要走 tab 页 + switchTab：
 *   reLaunch 会销毁当前页、重建目标页 —— 用户看到的就是整页白闪一下，
 *   而且目标页的骨架屏会重新出现。switchTab 复用已存在的页面实例，切换是瞬时的。
 *
 * 跳转函数本身在 utils/router.ts，这里只留 tab 页相关的常量与平台差异处理。
 */

export { switchTab } from './router'
export const TAB_HOME = 'pages/index/index'
export const TAB_ME = 'pages/me/index'

/**
 * 藏掉平台自带的 tabBar。
 *
 * 微信端 tabBar.custom = true，原生栏根本不渲染，这里会走 fail —— 正常。
 * H5 端不支持 custom，会渲染一条原生栏，必须藏掉，否则和我们自己的 AppTabBar 重叠。
 * （H5 首帧的闪现由 common.scss 里的 uni-tabbar 规则兜底）
 */
export function hideNativeTabBar(): void {
  uni.hideTabBar({
    animation: false,
    fail: () => {
      /* 没有原生 tabBar 时（微信 custom / 未声明）忽略 */
    }
  })
}
