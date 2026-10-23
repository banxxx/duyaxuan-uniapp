/**
 * 与设计稿一一对应的数据模型。
 * 字段命名沿用 duyaxuan.pen 里「设计规范 · 数据模型」区块的约定。
 */

/** 投票类型：问卷是特殊的一种，列表里同列表展示、靠标识区分 */
export type PollType = 'single' | 'multiple' | 'survey'

/** 投票状态：由 endAt 与当前时间算出来，不落库 */
export type PollStatus = 'ongoing' | 'ended'

export type ResultVisibility = 'always' | 'after_vote' | 'after_end' | 'hidden'
export type JoinMethod = 'link' | 'group' | 'private'

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
  /**
   * 42 我参与的列表里「你投了：安吉」用的摘要。
   * 单选是选项名，多选是「N 项」；后端在列表接口里一并返回，避免每行再查一次。
   */
  myChoice?: string
  myChoiceCount?: number
  deletedAt?: number | null
}

export interface Vote {
  id: string
  pollId: string
  optionIds: string[]
  createdAt: number
  /** 匿名投票时不返回 */
  user?: { id: string; name: string; avatar?: string }
}

export interface SurveyAnswer {
  id: string
  pollId: string
  content: string
  createdAt: number
  updatedAt?: number
  /** 匿名收集时不返回 */
  user?: { id: string; name: string; avatar?: string }
  /** 汇总时归到哪个选项 */
  optionId?: string | null
}

export interface Comment {
  id: string
  pollId: string
  content: string
  createdAt: number
  likeCount: number
  user: { id: string; name: string; avatar?: string }
  replyTo?: { id: string; name: string }
}

export interface UserProfile {
  id: string
  nickname: string
  avatar?: string
  bio?: string
  createdAt: number
  /** 手机号，已脱敏（138****8888）；未绑定时为空 */
  phone?: string
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
