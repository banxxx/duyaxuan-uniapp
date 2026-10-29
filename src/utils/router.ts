/**
 * 路由
 *
 * 所有页面跳转都走这里，页面里不要再直接写 uni.navigateTo / redirectTo。
 *
 * 为什么要有这一层：
 *   1. 路径是手写字符串，拼错了要到运行时才发现；这里收成 ROUTES 一张表。
 *   2. 「返回到哪一页」原本散落在各页面里。用 redirectTo 从 A 进 B 时，
 *      A 会被 B 顶掉，栈里就只剩一份 B —— 但如果 B 再 redirectTo 回 A，
 *      栈里就会出现两份 A，返回键回到的是那份旧的 A（数据还是旧的）。
 *      这类问题统一用 backTo() 解决：先找栈里已有的目标页，再按 delta 回退。
 */

/** 页面路径表，与 pages.json 的 pages 一一对应 */
export const ROUTES = {
  login: '/pages/login/index',
  home: '/pages/index/index',
  search: '/pages/search/index',

  detail: '/pages/detail/index',
  detailSuccess: '/pages/detail/success',
  detailResult: '/pages/detail/result',
  detailVoters: '/pages/detail/voters',
  detailComments: '/pages/detail/comments',
  share: '/pages/share/index',
  shareJoin: '/pages/share/join',

  createType: '/pages/create/type',
  createContent: '/pages/create/content',
  createRules: '/pages/create/rules',
  createSuccess: '/pages/create/success',

  creatorData: '/pages/creator/data',
  creatorEditContent: '/pages/creator/edit-content',
  creatorEditRules: '/pages/creator/edit-rules',

  surveyFill: '/pages/survey/fill',
  surveyDone: '/pages/survey/done',
  surveyMine: '/pages/survey/mine',
  surveyEditAnswer: '/pages/survey/edit-answer',
  surveyAnswers: '/pages/survey/answers',

  summary: '/pages/summary/index',
  summaryOption: '/pages/summary/option',
  summaryUnclassified: '/pages/summary/unclassified',

  me: '/pages/me/index',
  meCreated: '/pages/me/created',
  meJoined: '/pages/me/joined',

  settings: '/pages/settings/index',
  settingsNotifications: '/pages/settings/notifications',
  settingsAccount: '/pages/settings/account',
  settingsWechat: '/pages/settings/wechat',
  settingsDeactivate: '/pages/settings/deactivate',
  settingsDoc: '/pages/settings/doc',

  support: '/pages/support/index'
} as const

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES]

/** query 值：undefined / null / '' 会被丢掉，免得拼出 ?id= 这种空参数 */
export type RouteQuery = Record<string, string | number | undefined | null>

function normalize(path: string): string {
  return `/${path.replace(/^\//, '')}`
}

/** 拼出带 query 的完整 url */
export function buildUrl(path: string, query?: RouteQuery): string {
  const base = normalize(path)
  if (!query) return base

  const pairs = Object.keys(query)
    .filter((k) => query[k] !== undefined && query[k] !== null && query[k] !== '')
    .map((k) => `${k}=${encodeURIComponent(String(query[k]))}`)

  return pairs.length ? `${base}?${pairs.join('&')}` : base
}

/** 打开新页面（可返回） */
export function go(path: string, query?: RouteQuery): void {
  uni.navigateTo({ url: buildUrl(path, query) })
}

/** 用新页面顶掉当前页（当前页不进栈） */
export function replace(path: string, query?: RouteQuery): void {
  uni.redirectTo({ url: buildUrl(path, query) })
}

/**
 * 结束一个流程后清栈进入目标页。
 *
 * 创建流程走完（29 → 30 → 31 → 发布成功）时，前面几个步骤页不该留在栈里，
 * 否则从数据页返回会退回到已经作废的填写页。小程序没有「只清掉某几层」的 API，
 * 只能整栈重开。
 */
export function reset(path: string, query?: RouteQuery): void {
  uni.reLaunch({ url: buildUrl(path, query) })
}

/**
 * 退出一个多步流程（如创建投票的三步向导），回到进入流程前的那一页。
 *
 * 不能用 reLaunch：H5 上它会把整棵页面树拆掉再重建，中间闪一帧白屏，
 * 用户看到的就是「点取消 → 白一下 → 回到首页」。
 * 栈里还有上一页时直接 navigateBack 把流程页一起弹掉，页面实例还在，不会闪；
 * 只有从分享卡片直接进来（栈里只有一页）时才退回首页。
 */
export function exitFlow(fallback: string = ROUTES.home): void {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack({ delta: pages.length - 1 })
    return
  }
  switchTab(fallback)
}

/** 切 tab 页（复用页面实例，不重建） */
export function switchTab(path: string): void {
  uni.switchTab({
    url: normalize(path),
    fail: () => {
      // 兜底：万一页面没进 tabBar.list，退回 reLaunch，保证不卡住
      uni.reLaunch({ url: normalize(path) })
    }
  })
}

/**
 * 返回上一页。
 *
 * 栈里还有上一页就正常退；已经到栈底（从分享卡片直接进来、或当前是 tab 页）
 * 就回首页，不能什么都不做 —— 那样按钮看起来是坏的。
 */
export function back(fallback: string = ROUTES.home): void {
  if (getCurrentPages().length > 1) {
    uni.navigateBack()
    return
  }
  switchTab(fallback)
}

/** 当前页面路径（不含 query），如 pages/detail/index */
function currentRoute(page: Page.PageInstance): string {
  const route = (page as unknown as { route?: string; $page?: { fullPath?: string } }).route
  return normalize(route ?? '')
}

/**
 * 回到栈里已有的某一页。
 *
 * 典型场景：详情 → 结果页，结果页的「返回投票详情」如果直接 redirectTo，
 * 详情页就被顶成两份，返回键会回到那份数据没刷新的旧详情。
 * 这里先往后找栈里的详情页，找到就按 delta 退回去（数据是原来的实例，还在）。
 *
 * 栈里没有目标页（从分享卡片直接进来）时才退回 replace。
 */
export function backTo(path: string, query?: RouteQuery): void {
  const target = normalize(path)
  const pages = getCurrentPages()

  for (let i = pages.length - 2; i >= 0; i--) {
    if (currentRoute(pages[i]) === target) {
      uni.navigateBack({ delta: pages.length - 1 - i })
      return
    }
  }

  replace(path, query)
}
