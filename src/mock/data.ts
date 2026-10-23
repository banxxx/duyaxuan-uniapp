import type { Poll, Comment, SurveyAnswer } from '@/types/api'

/**
 * 本地假数据 —— 与设计稿完全对齐
 *
 * 后端还没起来时用它跑通页面；接后端后把 .env 的 VITE_USE_MOCK 关掉即可。
 * 数据口径沿用设计稿：
 *   「部门月度之星评选」42 票 / 9 条评论（41 列表首行，编辑页 90/91 编辑的就是它）
 *   「公司文化衫设计建议」问卷 34 条回答 / 3 条评论（已截止）
 *   「下季度团建地点」89 人已投票，41/28/14/6 票（05/09/21 详情页）
 */

const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const now = Date.now()

const baseRules = {
  anonymous: true,
  allowEdit: false,
  allowShare: true,
  limitIp: false,
  allowComment: true,
  joinMethod: 'link' as const,
  profileField: null,
  endAt: now + 3 * DAY
}

export const mockPolls: Poll[] = [
  {
    id: 'p_star',
    type: 'single',
    title: '部门月度之星评选',
    desc: '每人一票，10 月 26 日公布结果，得票最高者为本月之星。',
    creatorId: '1024',
    creatorName: '林小满',
    createdAt: now - 2 * DAY,
    rules: { ...baseRules, endAt: now + 3 * DAY },
    options: [
      { id: 'o1', title: '张伟 · 市场部', desc: '本月签下 6 个新客户', votes: 18 },
      { id: 'o2', title: '李静 · 产品部', desc: '主导新版投票页改版', votes: 11 },
      { id: 'o3', title: '王磊 · 技术部', desc: '上线 3 个核心功能', votes: 8 },
      { id: 'o4', title: '陈曦 · 设计部', desc: '完成品牌视觉更新', votes: 5 }
    ],
    voterCount: 42,
    commentCount: 9,
    viewCount: 186
  },
  {
    id: 'p_tea',
    type: 'multiple',
    title: '周五下午茶菜单',
    desc: '最多选 3 项，票数最高的三项本周五下午供应。',
    creatorId: '1024',
    creatorName: '林小满',
    createdAt: now - 1 * DAY,
    rules: { ...baseRules, maxChoice: 3, endAt: now + 2 * DAY },
    options: [
      { id: 'o1', title: '奶茶 · 三分糖', votes: 22 },
      { id: 'o2', title: '水果拼盘', votes: 19 },
      { id: 'o3', title: '现磨咖啡', votes: 15 },
      { id: 'o4', title: '轻食沙拉', votes: 8 }
    ],
    voterCount: 31,
    commentCount: 4,
    viewCount: 92
  },
  {
    id: 'p_plant',
    type: 'single',
    title: '办公室绿植品种投票',
    desc: '工位区域统一摆放，选一种。',
    creatorId: '1024',
    creatorName: '林小满',
    createdAt: now - 12 * DAY,
    rules: { ...baseRules, endAt: now - 1 * DAY },
    options: [
      { id: 'o1', title: '龟背竹', votes: 68 },
      { id: 'o2', title: '琴叶榕', votes: 52 },
      { id: 'o3', title: '虎皮兰', votes: 32 }
    ],
    voterCount: 152,
    commentCount: 8,
    viewCount: 402
  },
  {
    id: 'p_seat',
    type: 'single',
    title: '新办公室工位朝向',
    desc: '两种布局方案，选一个。',
    creatorId: '1024',
    creatorName: '林小满',
    createdAt: now - 26 * DAY,
    rules: { ...baseRules, endAt: now - 15 * DAY },
    options: [
      { id: 'o1', title: '面窗布局', votes: 29 },
      { id: 'o2', title: '背窗布局', votes: 18 }
    ],
    voterCount: 47,
    commentCount: 0,
    viewCount: 118
  },
  {
    id: 'p_shirt',
    type: 'survey',
    title: '公司文化衫设计建议',
    desc: '想让文化衫好看一点，说说你喜欢的风格或图案。',
    creatorId: '1024',
    creatorName: '林小满',
    createdAt: now - 2 * DAY,
    rules: {
      ...baseRules,
      allowEdit: true,
      allowRepeat: false,
      resultVisibility: undefined,
      endAt: now - 1 * DAY
    },
    options: [],
    voterCount: 34,
    answerCount: 34,
    commentCount: 3,
    viewCount: 210
  },
  {
    id: 'p_team',
    type: 'single',
    title: '下季度团建地点，你最想去哪里？',
    desc: '预算 300 元/人，两天一夜。请选择你最想去的目的地，得票最高者即为最终方案。',
    creatorId: 'u_zhou',
    creatorName: '周子墨',
    createdAt: now - 2 * DAY,
    rules: { ...baseRules, profileField: '部门', endAt: now + 3 * DAY + 6 * HOUR },
    options: [
      { id: 'o1', title: '莫干山 · 山野民宿', desc: '含徒步与篝火，适合放松', votes: 28 },
      { id: 'o2', title: '安吉 · 竹林露营', desc: '户外体验，需自带装备', votes: 41 },
      { id: 'o3', title: '千岛湖 · 环湖骑行', desc: '骑行 + 游船，强度适中', votes: 14 },
      { id: 'o4', title: '苏州 · 古镇慢游', desc: '人文路线，节奏轻松', votes: 6 }
    ],
    voterCount: 89,
    commentCount: 12,
    viewCount: 612,
    // 我参与的列表里显示「你投了：安吉」
    myChoice: '安吉'
  },
  {
    id: 'p_weekend',
    type: 'multiple',
    title: '周末团建活动，你想安排哪些项目？',
    desc: '可多选，最多选 3 项。票数最高的两项将进入最终方案。',
    creatorId: 'u_zhou',
    creatorName: '周子墨',
    createdAt: now - 2 * DAY,
    rules: { ...baseRules, maxChoice: 3, endAt: now + 3 * DAY + 6 * HOUR },
    options: [
      { id: 'o1', title: '山野徒步', desc: '约 5 公里轻徒步', votes: 34 },
      { id: 'o2', title: '篝火晚会', desc: '含烧烤与音乐', votes: 29 },
      { id: 'o3', title: '温泉 SPA', desc: '需额外预订', votes: 24 },
      { id: 'o4', title: '桌游之夜', desc: '室内活动', votes: 18 },
      { id: 'o5', title: '摄影采风', desc: '适合出片', votes: 11 }
    ],
    voterCount: 89,
    commentCount: 8,
    viewCount: 488,
    myChoiceCount: 2
  },
  // 下面三场是「别人邀请我、我还没投」，首页 02 的待办卡从这里取。
  // 必须是真实存在的投票，否则点卡片进详情会查不到。
  {
    id: 'p_lunch',
    type: 'single',
    title: '午餐去哪儿吃？',
    desc: '今天中午团建餐，选一家，12 点前截止。',
    creatorId: 'u_zhou',
    creatorName: '周子墨',
    createdAt: now - 6 * HOUR,
    rules: { ...baseRules, endAt: now + 8 * HOUR },
    options: [
      { id: 'o1', title: '楼下湘菜', desc: '人均 45', votes: 142 },
      { id: 'o2', title: '日式定食', desc: '人均 52', votes: 118 },
      { id: 'o3', title: '轻食沙拉', desc: '人均 38', votes: 66 }
    ],
    voterCount: 326,
    commentCount: 5,
    viewCount: 402
  },
  {
    id: 'p_team_time',
    type: 'single',
    title: '下季度团建时间投票',
    desc: '两天一夜，选一个大家都能来的周末。',
    creatorId: 'u_zhou',
    creatorName: '周子墨',
    createdAt: now - 3 * DAY,
    rules: { ...baseRules, endAt: now + 3 * DAY + 6 * HOUR },
    options: [
      { id: 'o1', title: '11 月 8–9 日', votes: 18 },
      { id: 'o2', title: '11 月 15–16 日', votes: 15 },
      { id: 'o3', title: '11 月 22–23 日', votes: 9 }
    ],
    voterCount: 42,
    commentCount: 2,
    viewCount: 96
  },
  {
    id: 'p_move',
    type: 'multiple',
    title: '办公室搬迁日投票',
    desc: '最多选 2 个你方便的日期。',
    creatorId: 'u_yi',
    creatorName: '陈一',
    createdAt: now - 2 * DAY,
    rules: { ...baseRules, maxChoice: 2, endAt: now + 3 * DAY + 6 * HOUR },
    options: [
      { id: 'o1', title: '11 月 1 日 · 周六', votes: 12 },
      { id: 'o2', title: '11 月 2 日 · 周日', votes: 14 },
      { id: 'o3', title: '11 月 8 日 · 周六', votes: 7 }
    ],
    voterCount: 26,
    commentCount: 1,
    viewCount: 71
  }
]

export const mockComments: Comment[] = [
  {
    id: 'c1',
    pollId: 'p_team',
    content: '安吉的竹林晚上会冷，记得带外套',
    createdAt: now - 2 * HOUR,
    likeCount: 12,
    user: { id: 'u_zhou', name: '周子墨' }
  },
  {
    id: 'c2',
    pollId: 'p_team',
    content: '千岛湖骑行强度会不会太大？',
    createdAt: now - 1 * HOUR,
    likeCount: 8,
    user: { id: 'u_chen', name: '陈一' }
  },
  {
    id: 'c3',
    pollId: 'p_team',
    content: '莫干山去过一次，民宿条件确实不错，晚上还能看星星。',
    createdAt: now - 46 * 60 * 1000,
    likeCount: 5,
    user: { id: '1024', name: '林小满' }
  }
]

export const mockAnswers: SurveyAnswer[] = [
  {
    id: 'a89',
    pollId: 'p_shirt',
    content: '想要简约一点的，深色底 + 小logo，通勤也能穿。',
    createdAt: now - 2 * 60 * 1000,
    user: undefined
  },
  {
    id: 'a88',
    pollId: 'p_shirt',
    content: '纯棉宽松版型，颜色选藏青或者米白，别太花。',
    createdAt: now - 18 * 60 * 1000,
    user: undefined
  },
  {
    id: 'a87',
    pollId: 'p_shirt',
    content: '可以印一句团队口号在背后，前面只放小图标。',
    createdAt: now - 42 * 60 * 1000,
    user: undefined
  }
]

/**
 * 我发起的列表顶部的三宫格统计
 *
 * 从 mockPolls 现算，不写死：新增/删除/提前结束后数字要跟着变，
 * 否则「进行中 2」和下面列出的 3 条对不上，用户第一眼就发现。
 */
export function mockStats() {
  const mine = mockPolls.filter((p) => p.creatorId === '1024')
  const ongoing = mine.filter((p) => p.rules.endAt > Date.now()).length
  const ended = mine.length - ongoing
  const total = mine.reduce((sum, p) => sum + p.voterCount, 0)
  return [
    { value: ongoing, label: '进行中' },
    { value: ended, label: '已结束' },
    { value: total >= 1000 ? `${(total / 1000).toFixed(1)}k` : total, label: '总参与' }
  ]
}

/* ============================================================
 * 02 首页 · 待我投票
 *
 * 和 41/42 不同，首页只放「别人邀请我、我还没投」的那几条，
 * 所以它有自己的排序口径：按截止时间由近到远，最急的在最上面。
 * ============================================================ */

export interface PendingPoll {
  id: string
  title: string
  type: 'single' | 'multiple'
  inviterName: string
  voterCount: number
  anonymous: boolean
  maxChoice?: number
  endAt: number
}

/**
 * 待办卡由 mockPolls 推导，不另存一份：
 * 卡片上的标题、人数、截止时间必须和详情页完全一致，
 * 两份数据各写一遍迟早会漂移（改了一处忘另一处）。
 */
const PENDING_IDS = ['p_lunch', 'p_team_time', 'p_move']

export const mockPending: PendingPoll[] = PENDING_IDS.map((id) => {
  const p = mockPolls.find((x) => x.id === id)!
  return {
    id: p.id,
    title: p.title,
    type: p.type as 'single' | 'multiple',
    inviterName: p.creatorName,
    voterCount: p.voterCount,
    anonymous: p.rules.anonymous,
    maxChoice: p.rules.maxChoice,
    endAt: p.rules.endAt
  }
}).sort((a, b) => a.endAt - b.endAt)

/* ============================================================
 * 我的投票状态
 *
 * 真机上这些由后端返回；这里用一张内存表模拟，刷新页面会重置。
 * ============================================================ */

/** pollId → 我投过的 optionId */
export const mockMyVotes: Record<string, string[]> = {
  p_team: ['o2'],
  p_weekend: ['o1', 'o2']
}

/** pollId → 我提交的问卷回答 id（可重复提交时有多条） */
export const mockMyAnswers: Record<string, string[]> = {}

/* ============================================================
 * 44 消息通知
 * ============================================================ */

export interface Notification {
  id: string
  kind: 'deadline' | 'comment' | 'result' | 'joined' | 'published'
  title: string
  content: string
  createdAt: number
  read: boolean
  /** 点进去落到哪个投票 */
  pollId?: string
}

export const mockNotifications: Notification[] = [
  {
    id: 'n1',
    kind: 'deadline',
    title: '投票即将截止',
    content: '「下季度团建时间投票」还有 3 天截止，记得投票',
    createdAt: now - 10 * 60 * 1000,
    read: false,
    pollId: 'p_team_time'
  },
  {
    id: 'n2',
    kind: 'comment',
    title: '新的评论',
    content: '周子墨 回复了你的评论：安吉的竹林晚上会冷…',
    createdAt: now - 1 * HOUR,
    read: false,
    pollId: 'p_team'
  },
  {
    id: 'n3',
    kind: 'result',
    title: '投票结果已公布',
    content: '「办公室绿植品种投票」结果：龟背竹 62%',
    createdAt: now - 3 * HOUR,
    read: false,
    pollId: 'p_plant'
  },
  {
    id: 'n4',
    kind: 'joined',
    title: '有人参与了你的投票',
    content: '陈一 参与了「周五下午茶菜单」',
    createdAt: now - 1 * DAY,
    read: true,
    pollId: 'p_tea'
  },
  {
    id: 'n5',
    kind: 'published',
    title: '投票已发布',
    content: '你的投票「周五下午茶菜单」已成功发布',
    createdAt: now - 3 * DAY,
    read: true,
    pollId: 'p_tea'
  }
]

/* ============================================================
 * 14/15 投票记录、73/74 回答记录
 * ============================================================ */

const voterNames = ['林小满', '陈一', '孙悦', '王思远', '李然', '吴桐', '赵敏', '周子墨']

export function mockVoters(pollId: string): Array<{
  id: string
  createdAt: number
  user?: { id: string; name: string }
  optionTitle: string
}> {
  return Array.from({ length: 8 }, (_, i) => ({
    id: `v${89 - i}`,
    createdAt: now - (3 + i * 5) * 60 * 1000,
    user: { id: `u${i}`, name: voterNames[i] },
    optionTitle: ['安吉 · 竹林露营', '莫干山 · 山野民宿', '千岛湖 · 环湖骑行', '苏州 · 古镇慢游'][i % 4]
  }))
}

/* ============================================================
 * 24/25 发布者数据页
 * ============================================================ */

export function mockPollStats(pollId: string) {
  return {
    voterCount: 89,
    totalVotes: 89,
    todayNew: 40,
    progress: 37,
    latestAt: now - 2 * 60 * 1000,
    trend: [
      { label: '10/20', value: 19 },
      { label: '10/21', value: 30 },
      { label: '10/22', value: 40 }
    ],
    hours: [
      { label: '上午 6-12', value: 18, pct: 20 },
      { label: '下午 12-18', value: 34, pct: 38 },
      { label: '晚上 18-24', value: 28, pct: 31 },
      { label: '深夜 0-6', value: 9, pct: 11 }
    ],
    peakText: '投票高峰集中在下午 12-18 点，占全部票数的 38%'
  }
}

/* ============================================================
 * 84 汇总 · 整理回答
 * ============================================================ */

export interface SummaryCandidate {
  id: string
  title: string
  desc: string
  answerCount: number
  sample: string
}

export const mockCandidates: SummaryCandidate[] = [
  {
    id: 'c_anji',
    title: '安吉 · 竹林露营',
    desc: '竹林露营住一晚，第二天轻徒步',
    answerCount: 14,
    sample: '想去安吉，竹林露营住一晚，第二天徒步…'
  },
  {
    id: 'c_qiandao',
    title: '千岛湖 · 环湖骑行',
    desc: '环湖骑行 + 坐船，强度适中',
    answerCount: 12,
    sample: '千岛湖吧，环湖骑行强度适中，还能坐船…'
  },
  {
    id: 'c_moganshan',
    title: '莫干山 · 山野民宿',
    desc: '民宿住一晚，晚上还能看星星',
    answerCount: 11,
    sample: '莫干山，民宿条件好，晚上还能看星星…'
  },
  {
    id: 'c_suzhou',
    title: '苏州古镇 · 慢节奏',
    desc: '古镇慢游，拍照也好看',
    answerCount: 9,
    sample: '其实更想去苏州古镇，节奏慢一点，拍照…'
  }
]

export interface UnclassifiedAnswer {
  id: string
  createdAt: number
  content: string
}

export const mockUnclassified: UnclassifiedAnswer[] = [
  { id: '#13', createdAt: now - 42 * 60 * 1000, content: '都可以，听大家的' },
  { id: '#11', createdAt: now - 45 * 60 * 1000, content: '不太想去太远的地方，车程两小时以内' },
  { id: '#9', createdAt: now - 47 * 60 * 1000, content: '有没有海边？想看海' },
  { id: '#6', createdAt: now - 60 * 60 * 1000, content: '预算能再低点就好，200 以内' }
]

/* ============================================================
 * 58 帮助与反馈 · 常见问题
 * ============================================================ */

export const mockFaq = [
  {
    q: '投票可以修改吗？',
    a: '投票提交后不可修改。若发起人开启了「允许修改选择」，你可以在截止前进入详情页点击「撤回」重新投票。'
  },
  { q: '如何发起匿名投票？', a: '创建流程第三步「投票规则」里打开「匿名投票」开关即可，参与者身份不会记录。' },
  { q: '为什么看不到投票结果？', a: '发起人可以在「投票结果显示」里设置投票后查看、结束后查看或禁止查看。' },
  { q: '如何导出投票数据？', a: '在投票数据页底部点「导出数据」，会生成 CSV 文件并发送到你的微信。' },
  { q: '投票过期了还能恢复吗？', a: '截止后不能重新开启，但可以复制一份新的投票继续收集。' }
]

