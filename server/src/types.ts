/**
 * 后端共享类型
 *
 * 行类型（*Row）严格对应 schema.sql 的列，转换到前端的 Poll / UserProfile
 * 统一在 db/ 层做（toPoll / toProfile），路由层只碰前端类型。
 */

export interface Env {
  DB: D1Database
  /** 头像存储，wrangler.toml 里开了 R2 才有 */
  BUCKET?: R2Bucket
  WX_APPID: string
  WX_SECRET: string
  JWT_SECRET: string
  TOKEN_TTL_DAYS: string
  /**
   * 开发期的登录后门，只有 .dev.vars 里写成 'true' 才生效。
   * 线上不配置这个变量，路由直接 404，和没写过一样。
   */
  DEV_LOGIN?: string
  /**
   * 小程序码指向的版本：release（正式版）/ trial（体验版）/ develop（开发版）。
   * 默认 release；本地开发在 .dev.vars 里写 trial，否则小程序没发布时扫不出页面。
   */
  WX_ENV_VERSION?: string
  /**
   * MixAuth 扫码登录服务的地址（H5 的 QQ / 微信登录）。
   * 只由 Worker 访问：客户端直连 vercel.app 在境内会被 DNS 污染。
   * 不配置时默认 https://mixauth-one.vercel.app。
   */
  MIXAUTH_BASE_URL?: string
  /**
   * 订阅消息模板 ID，在微信后台「功能 → 订阅消息」里选好模板后拿到。
   * 不配置就只发站内消息，接口照常工作 —— 开发期不需要去申请模板。
   */
  WX_TMPL_JOINED?: string
  WX_TMPL_COMMENT?: string
  WX_TMPL_DEADLINE?: string
  /** 结果公布：投票/问卷结束后通知参与者与发起人 */
  WX_TMPL_RESULT?: string
  /** 我参与的投票 / 问卷有更新 */
  WX_TMPL_UPDATED?: string
  /**
   * 通用模板：五类通知共用一个模板时填这个。
   * 单独配置了某一类（上面四个）时以单独配置为准。
   */
  WX_TMPL_NOTIFY?: string
  /**
   * 模板字段名，JSON：{"title":"thing4","content":"thing2","time":"time20"}。
   * 不同模板的字段名不一样（thing4 / phrase2 / character_string3），
   * 对不上时微信返回 47003，改这个变量即可，不用改代码。
   */
  WX_TMPL_FIELDS?: string
}

/** Hono 的上下文泛型：Bindings 是 env，Variables 是中间件往下传的东西 */
export interface AppEnv {
  Bindings: Env
  Variables: {
    /** requireAuth 保证有值；optionalAuth 下可能是 null */
    userId: string | null
  }
}

/* ---------------- 数据库行 ---------------- */

export interface UserRow {
  id: string
  nickname: string
  avatar: string | null
  bio: string | null
  status: number
  created_at: number
  updated_at: number
}

export interface PollRow {
  id: string
  creator_id: string
  type: string
  title: string
  desc: string | null
  status: number
  deleted_at: number | null
  /** 最近一次内容编辑时间；null 表示发布后从未编辑过 */
  updated_at: number | null
  created_at: number
  end_at: number
  anonymous: number
  allow_edit: number
  allow_share: number
  allow_comment: number
  allow_repeat: number
  limit_ip: number
  max_choice: number
  result_visibility: string
  shuffle_options: number
  hide_voter_count: number
  join_method: string
  invite_code: string | null
  profile_field: string | null
  voter_count: number
  answer_count: number
  comment_count: number
  view_count: number
  source_survey_id: string | null
}

/** 列表/详情查询都会 LEFT JOIN users 取发起人信息 */
export interface PollRowJoined extends PollRow {
  creator_name: string | null
  creator_avatar: string | null
}

export interface OptionRow {
  id: string
  poll_id: string
  title: string
  desc: string | null
  /** 图文投票：JSON 数组，存 /files/options/... 相对地址；纯文字选项为 null */
  images: string | null
  sort: number
  votes_count: number
}

export interface VoteRow {
  id: string
  poll_id: string
  user_id: string
  option_ids: string
  profile_info: string | null
  ip: string | null
  created_at: number
}

export interface AnswerRow {
  id: string
  poll_id: string
  user_id: string
  seq: number
  content: string
  profile_info: string | null
  created_at: number
  updated_at: number
}

/* ---------------- 出参类型（与 src/types/api.d.ts 对齐） ---------------- */

export type PollType = 'single' | 'multiple' | 'survey'
export type PollStatusFilter = 'all' | 'ongoing' | 'ended'

export interface PollRules {
  anonymous: boolean
  allowEdit: boolean
  allowShare: boolean
  limitIp: boolean
  allowComment: boolean
  allowRepeat?: boolean
  maxChoice?: number
  resultVisibility?: string
  shuffleOptions?: boolean
  hideVoterCount?: boolean
  joinMethod: string
  profileField: string | null
  endAt: number
}

export interface PollOptionOut {
  id: string
  title: string
  desc?: string
  /** 图文投票的配图，最多 3 张；没有图时不带这个字段 */
  images?: string[]
  votes: number
}

export interface PollOut {
  id: string
  type: PollType
  title: string
  desc?: string
  creatorId: string
  creatorName: string
  creatorAvatar?: string
  createdAt: number
  rules: PollRules
  options: PollOptionOut[]
  voterCount: number
  commentCount: number
  viewCount: number
  answerCount?: number
  sourceSurveyId?: string
  myChoice?: string
  myChoiceCount?: number
  myAnswered?: boolean
  deletedAt?: number | null
  /** 最近一次内容编辑时间；有值才显示「已编辑」 */
  updatedAt?: number
  /** 最近一次投票/提交的时间戳，详情页用来显示「最近投票」 */
  latestAt?: number
  /** 邀请码：只有发起人拿得到，由发起人单独告知参与者，不随链接/海报传播 */
  inviteCode?: string
}

export interface UserProfileOut {
  id: string
  nickname: string
  avatar?: string
  bio?: string
  createdAt: number
  bound?: boolean
}

export interface SurveyAnswerOut {
  id: string
  pollId: string
  content: string
  createdAt: number
  updatedAt?: number
  user?: { id: string; name: string; avatar?: string }
  profileInfo?: string
}

export interface Paged<T> {
  list: T[]
  cursor: string | null
  hasMore: boolean
  total: number
}
