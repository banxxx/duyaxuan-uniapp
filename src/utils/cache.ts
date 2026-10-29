/**
 * 页面数据缓存（内存版 stale-while-revalidate）
 *
 * 问题：小程序里 navigateBack 会把离开的页面销毁，再进去就是全新实例。
 * 于是每次「列表 → 详情 → 返回 → 再进详情」都要从零请求，
 * 骨架屏就再闪一次 —— 明明数据一秒前才加载过。
 *
 * 做法：把上一次的结果按 key 留在 JS 内存里。页面进来时先渲染缓存，
 * 同时照常发请求，拿到新数据再替换（SWR）。用户看到的是「立刻有内容」，
 * 数据仍然是新的。
 *
 * 为什么不落本地存储：
 *   - 冷启动会先显示上次的票数/评论，看起来像「数据没刷新」；
 *   - 失效逻辑要从「一次运行」扩大到「跨版本」，不值得。
 * 所以这里只活在小程序运行期间，退出即清空。
 */

/**
 * 默认 5 分钟。
 *
 * 这个时长不决定「数据新不新」—— 页面进来永远会重新请求，只是请求回来之前
 * 先拿缓存顶上。所以宁可给长一点：超过 5 分钟再进来，才退回骨架屏。
 */
const DEFAULT_TTL = 5 * 60_000

/** 最多留 60 条：一个投票详情 + 讨论区 + 记录 + 结果，够存十几条投票 */
const MAX_ENTRIES = 60

interface Entry {
  at: number
  data: unknown
}

const store = new Map<string, Entry>()

/** 读缓存：没有或已过期返回 undefined */
export function cacheGet<T>(key: string, ttl: number = DEFAULT_TTL): T | undefined {
  const hit = store.get(key)
  if (!hit) return undefined
  if (ttl > 0 && Date.now() - hit.at > ttl) {
    store.delete(key)
    return undefined
  }
  return hit.data as T
}

/** 写缓存，返回原值 —— 调用处可以 `poll.value = cacheSet(key, p)` 一行写完 */
export function cacheSet<T>(key: string, data: T): T {
  // 先删再插，让这个 key 排到队尾（Map 按插入顺序迭代）
  store.delete(key)
  store.set(key, { at: Date.now(), data })

  // 超量时丢最久没被写入的那条，防止逛一晚上把内存撑起来
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
  return data
}

/**
 * 按前缀失效。
 *
 * 投票、评论、编辑这些写操作之后调用，把这条投票相关的快照全部丢掉，
 * 否则再进详情会先闪一下旧票数。
 */
export function cacheDrop(prefix: string): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}

/** 全部清空（设置页「清除缓存」调用） */
export function cacheClear(): void {
  store.clear()
}

/**
 * 缓存键集中在这里拼。
 *
 * 统一前缀是有意的：`poll:<id>:` 开头的一律能被 cacheDrop 按前缀清掉，
 * 页面里各写各的字符串，迟早会漏掉一处。
 */
export const cacheKey = {
  /** 前缀：一条投票下的所有快照，写操作后用 cacheDrop 一次清干净 */
  pollAll: (id: string) => `poll:${id}:`,
  /** 详情页整屏快照（投票 + 我的选择 + 评论 + 头像叠层） */
  pollDetail: (id: string) => `poll:${id}:detail`,
  /** 讨论区列表 */
  pollComments: (id: string) => `poll:${id}:comments`,
  /** 投票记录 / 回答列表的第一页 */
  pollVoters: (id: string) => `poll:${id}:voters`,
  /** 结果页的票数快照 */
  pollResult: (id: string) => `poll:${id}:result`,
  /** 发起人的数据页（投票 + 趋势/时段统计） */
  pollData: (id: string) => `poll:${id}:data`,
  /** 问卷汇总页（问卷 + 候选/未归类） */
  pollSummary: (id: string) => `poll:${id}:summary`,
  /** 汇总 · 单个选项的编辑页 */
  summaryOption: (surveyId: string, optionId: string) => `poll:${surveyId}:summary-option:${optionId}`,
  /** 汇总 · 未归类回答 */
  summaryUnclassified: (surveyId: string) => `poll:${surveyId}:summary-unclassified`,
  /** 分享页 */
  pollShare: (id: string) => `poll:${id}:share`,
  /** 我发起的 / 我参与的 列表（按筛选条件分开存） */
  pollList: (tab: 'mine' | 'joined', status: string) => `list:${tab}:${status}`
}
