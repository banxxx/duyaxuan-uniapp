import type {
  Poll,
  Comment,
  SurveyAnswer,
  SummaryCandidate,
  UnclassifiedAnswer,
  Notification
} from '@/types/api'

/**
 * 本地假数据 —— 与设计稿完全对齐
 *
 * 后端还没起来时用它跑通页面；接后端后把 .env 的 VITE_USE_MOCK 关掉即可。
 * 数据口径沿用设计稿：
 *   「社区月度之星评选」42 票 / 9 条评论（41 列表首行，编辑页 90/91 编辑的就是它）
 *   「关于下次出游」问卷 34 条回答 / 3 条评论（已截止，可汇总）
 *   「出游预算怎么分配？」问卷 12 条回答（进行中，我在 71 里有 3 次提交）
 *   「下次出游地点」89 人已投票，41/28/14/6 票（05/09/21 详情页）
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
    title: '社区月度之星评选',
    desc: '每人一票，10 月 26 日公布结果，得票最高者为本月之星。',
    creatorId: '1024',
    creatorName: '林小满',
    createdAt: now - 2 * DAY,
    rules: { ...baseRules, endAt: now + 3 * DAY },
    options: [
      { id: 'o1', title: '张伟 · 志愿者', desc: '本月参与志愿服务 6 次', votes: 18 },
      { id: 'o2', title: '李静 · 文艺队', desc: '组织了两场社区演出', votes: 11 },
      { id: 'o3', title: '王磊 · 运动队', desc: '带队拿下街道比赛', votes: 8 },
      { id: 'o4', title: '陈曦 · 手工坊', desc: '开了三期公益手工课', votes: 5 }
    ],
    voterCount: 42,
    commentCount: 9,
    viewCount: 186
  },
  {
    id: 'p_tea',
    type: 'multiple',
    title: '周末下午茶菜单',
    desc: '最多选 3 项，票数最高的三项周末一起安排。',
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
    title: '阳台绿植品种投票',
    desc: '阳台统一摆放，选一种。',
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
    title: '新家书桌朝向',
    desc: '两种摆放方案，选一个。',
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
    title: '关于下次出游，你有什么想法？',
    desc: '随便聊聊想去哪、想玩什么，我们会根据大家的回答整理成投票方案。',
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
    id: 'p_survey_team',
    type: 'survey',
    title: '出游预算怎么分配？',
    desc: '说说你希望预算花在哪些地方，比如住宿、餐饮、活动。',
    creatorId: 'u_zhou',
    creatorName: '周子墨',
    createdAt: now - 2 * DAY,
    rules: {
      ...baseRules,
      allowEdit: true,
      // 允许重复提交：详情页才会出现「再填一次」，也才对得上我在 71 里的 3 条记录
      allowRepeat: true,
      resultVisibility: undefined,
      endAt: now + 2 * DAY
    },
    options: [],
    voterCount: 12,
    answerCount: 12,
    commentCount: 0,
    viewCount: 64
  },
  {
    id: 'p_team',
    type: 'single',
    title: '下次出游地点，你最想去哪里？',
    desc: '预算 300 元/人，两天一夜。请选择你最想去的目的地，得票最高者即为最终方案。',
    creatorId: 'u_zhou',
    creatorName: '周子墨',
    createdAt: now - 2 * DAY,
    rules: { ...baseRules, profileField: '联系方式', endAt: now + 3 * DAY + 6 * HOUR },
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
    title: '周末出游活动，你想安排哪些项目？',
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
    desc: '今天中午聚餐，选一家，12 点前截止。',
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
    title: '下次出游时间投票',
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
    title: '搬家日期投票',
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
  },
  {
    id: 'c4',
    pollId: 'p_shirt',
    content: '安吉的竹林晚上会冷，记得带件外套。',
    createdAt: now - 3 * HOUR,
    likeCount: 4,
    user: { id: 'u_zhou', name: '周子墨' }
  },
  {
    id: 'c5',
    pollId: 'p_shirt',
    content: '千岛湖骑行强度还好，慢慢骑就行。',
    createdAt: now - 2 * HOUR,
    likeCount: 2,
    user: { id: 'u_chen', name: '陈一' }
  },
  {
    id: 'c6',
    pollId: 'p_shirt',
    content: '预算 300 够吗？住宿好像会超。',
    createdAt: now - 1 * HOUR,
    likeCount: 1,
    user: { id: '1024', name: '林小满' }
  }
]

/**
 * 「关于下次出游，你有什么想法？」的 34 条回答（匿名，所以不带 user）
 *
 * 前 30 条正好落进 84 汇总页的 4 个候选（安吉 10 / 千岛湖 8 / 莫干山 7 / 苏州 5），
 * 后 4 条就是 86 里的未归类 —— 汇总页三块统计相加必须等于 34，
 * 否则「34 条回答已整理好」下面写着 30 + 4 会少 4 条。
 */
const SHIRT_ANSWERS: string[] = [
  // 安吉 · 竹林露营 ×10
  '想去安吉，竹林露营住一晚，第二天轻徒步。',
  '投安吉一票，竹林露营听起来就很放松。',
  '安吉吧，露营加徒步，两天一夜节奏刚好。',
  '安吉 · 竹林露营，能住帐篷最好。',
  '想去安吉看竹林，顺便露营一晚。',
  '安吉，露营住一晚再徒步，不用赶路。',
  '安吉竹林露营 +1，想去很久了。',
  '安吉，露营和徒步都能玩到。',
  '安吉吧，竹林拍照也好看。',
  '安吉 · 竹林露营，那边蚊虫多不多？',
  // 千岛湖 · 环湖骑行 ×8
  '千岛湖吧，环湖骑行强度适中，还能坐船。',
  '千岛湖，骑行加游船，内容比较丰富。',
  '想去千岛湖骑车，环湖风景应该很好。',
  '千岛湖一票，环湖路线成熟，不容易迷路。',
  '千岛湖，骑累了还能坐船休息。',
  '千岛湖吧，强度不大，适合所有人。',
  '千岛湖 · 环湖骑行，想试试。',
  '千岛湖，游船那段最期待。',
  // 莫干山 · 山野民宿 ×7
  '莫干山，民宿条件好，晚上还能看星星。',
  '莫干山吧，想住山里的民宿。',
  '莫干山一票，安静一点，能真正休息。',
  '莫干山，徒步路线也不累。',
  '想去莫干山，民宿加篝火。',
  '莫干山，适合放松，不用折腾。',
  '莫干山 · 山野民宿，晚上看星星。',
  // 苏州古镇 ×5
  '其实更想去苏州古镇，节奏慢一点，拍照也好看。',
  '苏州吧，古镇走走挺舒服。',
  '苏州古镇，人文路线，基本不用体力。',
  '苏州一票，慢慢逛，吃点当地小吃。',
  '苏州古镇，两天一夜刚刚好。',
  // 未归类 ×4（对应 86 的 4 条）
  '都可以，听大家的。',
  '不太想去太远的地方，车程两小时以内。',
  '有没有海边？想看海。',
  '预算能再低点就好，200 以内。'
]

export const mockAnswers: SurveyAnswer[] = [
  ...SHIRT_ANSWERS.map((content, i) => ({
    id: String(89 - i),
    pollId: 'p_shirt',
    content,
    createdAt: now - (2 + i * 3) * 60 * 1000,
    user: undefined
  })),
  // 「出游预算怎么分配？」12 条，其中前 3 条是我（1024）重复提交的
  {
    id: 'sa3',
    pollId: 'p_survey_team',
    content: '住宿多分一点吧，住得舒服最重要。',
    createdAt: now - 26 * 60 * 1000,
    user: { id: '1024', name: '林小满' }
  },
  {
    id: 'sa2',
    pollId: 'p_survey_team',
    content: '餐饮和住宿各一半，活动留一点。',
    createdAt: now - 54 * 60 * 1000,
    user: { id: '1024', name: '林小满' }
  },
  {
    id: 'sa1',
    pollId: 'p_survey_team',
    content: '活动预算别砍太多，篝火和烧烤还是要有的。',
    createdAt: now - 3 * HOUR,
    user: { id: '1024', name: '林小满' }
  },
  {
    id: 'sb9',
    pollId: 'p_survey_team',
    content: '住宿 40%，餐饮 35%，活动 25% 这样分。',
    createdAt: now - 4 * HOUR,
    user: { id: 'u_zhou', name: '周子墨' }
  },
  {
    id: 'sb8',
    pollId: 'p_survey_team',
    content: '希望餐饮能多给一点，上次出游吃得太简单。',
    createdAt: now - 5 * HOUR,
    user: { id: 'u_chen', name: '陈一' }
  },
  {
    id: 'sb7',
    pollId: 'p_survey_team',
    content: '活动可以少花点，主要是住和吃。',
    createdAt: now - 6 * HOUR,
    user: { id: 'u_sun', name: '孙悦' }
  },
  {
    id: 'sb6',
    pollId: 'p_survey_team',
    content: '住宿标准不用太高，干净就行，钱留给活动。',
    createdAt: now - 8 * HOUR,
    user: { id: 'u_wang', name: '王思远' }
  },
  {
    id: 'sb5',
    pollId: 'p_survey_team',
    content: '交通也算在预算里吗？如果含交通，住宿就得降一点。',
    createdAt: now - 10 * HOUR,
    user: { id: 'u_li', name: '李然' }
  },
  {
    id: 'sb4',
    pollId: 'p_survey_team',
    content: '平均分就好，别太纠结比例。',
    createdAt: now - 12 * HOUR,
    user: { id: 'u_wu', name: '吴桐' }
  },
  {
    id: 'sb3',
    pollId: 'p_survey_team',
    content: '建议留 10% 做机动，临时买水买零食。',
    createdAt: now - 1 * DAY,
    user: { id: 'u_zhao', name: '赵敏' }
  },
  {
    id: 'sb2',
    pollId: 'p_survey_team',
    content: '活动预算多一点，不然两天一夜会很无聊。',
    createdAt: now - 1 * DAY - 2 * HOUR,
    user: { id: 'u_zhou', name: '周子墨' }
  },
  {
    id: 'sb1',
    pollId: 'p_survey_team',
    content: '都可以，按人头均摊最省事。',
    createdAt: now - 1 * DAY - 5 * HOUR,
    user: { id: 'u_chen', name: '陈一' }
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
  /** survey 是受邀但还没填写的问卷 */
  type: 'single' | 'multiple' | 'survey'
  inviterName: string
  voterCount: number
  answerCount?: number
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
    answerCount: p.answerCount,
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
export const mockMyAnswers: Record<string, string[]> = {
  // 「出游预算怎么分配？」我重复提交了 3 次，详情页显示「已提交 3 次」
  p_survey_team: ['sa3', 'sa2', 'sa1']
}

/* ============================================================
 * 44 消息通知
 * ============================================================ */

export type { Notification }

export const mockNotifications: Notification[] = [
  {
    id: 'n1',
    kind: 'deadline',
    title: '投票即将截止',
    content: '「下次出游时间投票」还有 3 天截止，记得投票',
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
    content: '「阳台绿植品种投票」结果：龟背竹 62%',
    createdAt: now - 3 * HOUR,
    read: false,
    pollId: 'p_plant'
  },
  {
    id: 'n4',
    kind: 'joined',
    title: '有人参与了你的投票',
    content: '陈一 参与了「周末下午茶菜单」',
    createdAt: now - 1 * DAY,
    read: true,
    pollId: 'p_tea'
  },
  {
    id: 'n5',
    kind: 'published',
    title: '投票已发布',
    content: '你的投票「周末下午茶菜单」已成功发布',
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

export const mockCandidates: SummaryCandidate[] = [
  {
    id: 'c_anji',
    title: '安吉 · 竹林露营',
    desc: '竹林露营住一晚，第二天轻徒步',
    answerCount: 10,
    sample: '想去安吉，竹林露营住一晚，第二天徒步…'
  },
  {
    id: 'c_qiandao',
    title: '千岛湖 · 环湖骑行',
    desc: '环湖骑行 + 坐船，强度适中',
    answerCount: 8,
    sample: '千岛湖吧，环湖骑行强度适中，还能坐船…'
  },
  {
    id: 'c_moganshan',
    title: '莫干山 · 山野民宿',
    desc: '民宿住一晚，晚上还能看星星',
    answerCount: 7,
    sample: '莫干山，民宿条件好，晚上还能看星星…'
  },
  {
    id: 'c_suzhou',
    title: '苏州古镇 · 慢节奏',
    desc: '古镇慢游，拍照也好看',
    answerCount: 5,
    sample: '其实更想去苏州古镇，节奏慢一点，拍照…'
  }
]

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
  { q: '如何发起匿名投票？', a: '创建流程第三步「投票规则」里打开「匿名投票」开关即可，投票记录和结果里不会展示参与者身份。' },
  { q: '为什么看不到投票结果？', a: '发起人可以在「投票结果显示」里设置投票后查看、结束后查看或禁止查看。' },
  { q: '可以导出投票数据吗？', a: '目前还不支持导出 CSV，可以在投票数据页查看实时统计和投票记录。' },
  { q: '投票过期了还能恢复吗？', a: '截止后不能重新开启，也暂不支持复制；需要继续收集时请重新创建一份。' }
]

