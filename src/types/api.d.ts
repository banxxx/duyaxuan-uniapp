/**
 * 与设计稿一一对应的数据模型。
 * 字段命名沿用 duyaxuan.pen 里「设计规范 · 数据模型」区块的约定。
 */

/** 投票类型：问卷是特殊的一种，列表里同列表展示、靠标识区分 */
export type PollType = 'single' | 'multiple' | 'survey'

/** 投票状态：由 endAt 与当前时间算出来，不落库 */
export type PollStatus = 'ongoing' | 'ended'

export type ResultVisibility = 'always' | 'after_vote' | 'after_end' | 'hidden'
/** 参与方式：链接可投 / 需要邀请码 */
export type JoinMethod = 'link' | 'invite'

export interface PollRules {
  /** 匿名投票 / 匿名收集 */
  anonymous: boolean
  /** 允许修改选择 / 允许修改回答 */
  allowEdit: boolean
  /** 允许参与者分享 */
  allowShare: boolean
  /** 限制同 IP */
  limitIp: boolean
  /** 允许评论 */
  allowComment: boolean
  /** 问卷专用：允许重复提交 */
  allowRepeat?: boolean
  /** 多选专用：最多可选几项（1–9），单选时为 1 */
  maxChoice?: number
  /** 结果可见性（问卷没有） */
  resultVisibility?: ResultVisibility
  /** 选项随机（问卷没有） */
  shuffleOptions?: boolean
  /** 禁止查看投票人数（问卷没有） */
  hideVoterCount?: boolean
  /** 参与方式 */
  joinMethod: JoinMethod
  /** 需个人信息：字段名，null 表示不需要 */
  profileField: string | null
  /** 截止时间（毫秒时间戳） */
  endAt: number
}

export interface PollOption {
  id: string
  title: string
  desc?: string
  /**
   * 图文投票的配图，最多 3 张，第一张是封面。
   * 存的是 `/files/options/...` 相对地址，渲染前用 resolveFileUrl 补全域名。
   */
  images?: string[]
  votes: number
  /** 汇总创建时标记：来自问卷的哪几条回答 */
  sourceAnswerIds?: string[]
  /** 编辑时新增、还没有票的选项 */
  isNew?: boolean
}

export interface Poll {
  id: string
  type: PollType
  title: string
  desc?: string
  creatorId: string
  creatorName: string
  creatorAvatar?: string
  createdAt: number
  rules: PollRules
  options: PollOption[]
  /** 总参与人数（多选时小于总票数） */
  voterCount: number
  commentCount: number
  viewCount: number
  /** 问卷：已收到回答数 */
  answerCount?: number
  /** 问卷汇总生成的投票，指向来源问卷 */
  sourceSurveyId?: string
  /** 最近一次投票/提交的时间戳 */
  latestAt?: number
  /**
   * 42 我参与的列表里「你投了：安吉」用的摘要。
   * 单选是选项名，多选是「N 项」；后端在列表接口里一并返回，避免每行再查一次。
   */
  myChoice?: string
  myChoiceCount?: number
  /**
   * 问卷：我是否已经提交过回答。
   * 列表里不能拿 answerCount 判断——那是所有人回答的总数，
   * 别人答了 34 条不代表我答过。
   */
  myAnswered?: boolean
  deletedAt?: number | null
  /** 最近一次内容编辑时间；有值才显示「已编辑」 */
  updatedAt?: number
  /**
   * 邀请码：只有发起人拿得到。
   * 不随分享链接 / 小程序码传播，需要发起人单独告知参与者。
   */
  inviteCode?: string
}

export interface Vote {
  id: string
  pollId: string
  optionIds: string[]
  createdAt: number
  /** 匿名投票时不返回 */
  user?: { id: string; name: string; avatar?: string }
  /** 发起人要求填写的个人信息，仅发起人可见 */
  profileInfo?: string
}

export interface SurveyAnswer {
  id: string
  pollId: string
  content: string
  createdAt: number
  updatedAt?: number
  /** 匿名收集时不返回 */
  user?: { id: string; name: string; avatar?: string }
  /** 发起人要求填写的个人信息，仅发起人可见 */
  profileInfo?: string
  /** 汇总时归到哪个选项 */
  optionId?: string | null
}

export interface Comment {
  id: string
  pollId: string
  content: string
  createdAt: number
  likeCount: number
  /** 我点过赞没有 */
  liked?: boolean
  /** 是不是我自己发的（「我参与的」筛选用） */
  isMine?: boolean
  user: { id: string; name: string; avatar?: string }
  /**
   * 被回复的那条评论的 id。
   *
   * 有它才能把回复挂到对应的楼层下面 —— replyTo 里存的是「被回复的人」，
   * 只知道是谁，不知道挂在哪条评论下。
   */
  replyToId?: string
  replyTo?: { id: string; name: string }
}

export interface UserProfile {
  id: string
  nickname: string
  avatar?: string
  bio?: string
  createdAt: number
  /** 是否绑定了微信 / QQ / 抖音，用于 46 与 54 */
  bound?: boolean
}

/** 分页响应的统一形状 */
export interface Paged<T> {
  list: T[]
  cursor: string | null
  hasMore: boolean
  total: number
}

/** 14/15 一条投票记录 */
export interface VoterRecord {
  id: string
  createdAt: number
  user?: { id: string; name: string }
  /** 投给了哪个选项（多选时用 / 连接） */
  optionTitle: string
  /** 发起人要求填的个人信息，只有发起人能拿到 */
  profileInfo?: string
}

/* ---------------- 84/85/86 问卷汇总 ---------------- */

/** 一个候选选项：由若干条回答归并而来 */
export interface SummaryCandidate {
  id: string
  title: string
  desc: string
  answerCount: number
  /** 取一条原文做示例 */
  sample: string
}

/** 还没归类的一条回答 */
export interface UnclassifiedAnswer {
  id: string
  createdAt: number
  content: string
}

/** 归在某个候选选项下的回答（85 编辑选项页用） */
export interface SummaryAnswer {
  id: string
  createdAt: number
  content: string
}

export interface SummaryOptionDetail extends SummaryCandidate {
  answers: SummaryAnswer[]
}

/* ---------------- 44 消息通知 ---------------- */

export interface Notification {
  id: string
  /** 图标按类型变：截止 / 评论 / 结果 / 参与 / 发布 / 更新 */
  kind: 'deadline' | 'comment' | 'result' | 'joined' | 'published' | 'updated'
  title: string
  content: string
  createdAt: number
  read: boolean
  /** 点进去落到哪个投票 / 问卷 */
  pollId?: string
}
