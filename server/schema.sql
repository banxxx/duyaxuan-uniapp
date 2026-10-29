-- ============================================================
-- 投票吧 · D1 表结构
--
-- 时间统一存毫秒时间戳（INTEGER）。前端 types/api.d.ts 里所有时间字段
-- 都是 number，直接对齐，不做字符串日期转换。
--
-- 布尔存 0/1（SQLite 没有 boolean），在 toPoll() 里转回 boolean。
--
-- 计数（voter_count / answer_count / comment_count / options.votes_count）
-- 是冗余字段：列表页要显示「42 人已投」，每行都 count(*) 一次太贵。
-- 写入时用 D1 的 batch() 和主记录放在同一个原子批次里，不会写歪。
-- ============================================================

-- 账号主体。昵称/头像以后从微信授权拿，所以给默认值
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  nickname   TEXT NOT NULL DEFAULT '',
  avatar     TEXT,
  bio        TEXT,
  status     INTEGER NOT NULL DEFAULT 0,   -- 0 正常 / 1 已注销
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 一个账号可以绑多个平台（前端有「解绑」）。现在只实现微信，
-- 表结构留着，将来接 QQ / 抖音不用改表。
CREATE TABLE IF NOT EXISTS user_platforms (
  user_id    TEXT NOT NULL,
  platform   TEXT NOT NULL,                -- weixin | qq | toutiao
  openid     TEXT NOT NULL,
  unionid    TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (platform, openid)
);
CREATE INDEX IF NOT EXISTS ix_user_platforms_user ON user_platforms(user_id);

-- 投票 / 问卷。规则平铺成列，不塞 JSON —— 将来加索引和查询都方便
CREATE TABLE IF NOT EXISTS polls (
  id                TEXT PRIMARY KEY,
  creator_id        TEXT NOT NULL,
  type              TEXT NOT NULL,          -- single | multiple | survey
  title             TEXT NOT NULL,
  desc              TEXT,
  status            INTEGER NOT NULL DEFAULT 0,  -- 0 进行中 / 1 已结束
  deleted_at        INTEGER,                     -- 软删除，支持「恢复」
  created_at        INTEGER NOT NULL,
  end_at            INTEGER NOT NULL,

  -- 规则
  anonymous         INTEGER NOT NULL DEFAULT 1,
  allow_edit        INTEGER NOT NULL DEFAULT 0,
  allow_share       INTEGER NOT NULL DEFAULT 1,
  allow_comment     INTEGER NOT NULL DEFAULT 1,
  allow_repeat      INTEGER NOT NULL DEFAULT 0,  -- 问卷：允许重复提交
  limit_ip          INTEGER NOT NULL DEFAULT 0,
  max_choice        INTEGER NOT NULL DEFAULT 1,
  result_visibility TEXT NOT NULL DEFAULT 'after_vote',
  shuffle_options   INTEGER NOT NULL DEFAULT 0,
  hide_voter_count  INTEGER NOT NULL DEFAULT 0,
  join_method       TEXT NOT NULL DEFAULT 'link', -- link（持链接可投）| invite（需要邀请码）
  invite_code       TEXT,                        -- 邀请码，join_method=invite 时生成；链接里带着它
  profile_field     TEXT,                        -- 需要参与者填的字段名，null = 不需要

  -- 冗余计数
  voter_count       INTEGER NOT NULL DEFAULT 0,
  answer_count      INTEGER NOT NULL DEFAULT 0,
  comment_count     INTEGER NOT NULL DEFAULT 0,
  view_count        INTEGER NOT NULL DEFAULT 0,

  source_survey_id  TEXT                         -- 由问卷汇总生成时指向来源
);
CREATE INDEX IF NOT EXISTS ix_polls_creator ON polls(creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_polls_created ON polls(created_at DESC);

CREATE TABLE IF NOT EXISTS options (
  id          TEXT PRIMARY KEY,
  poll_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  desc        TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  votes_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_options_poll ON options(poll_id, sort);

-- 一次投票 = 一行。option_ids 存 JSON 数组（多选时多个）
CREATE TABLE IF NOT EXISTS votes (
  id           TEXT PRIMARY KEY,
  poll_id      TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  option_ids   TEXT NOT NULL,
  profile_info TEXT,                        -- 发起人要求填的个人信息，JSON
  ip           TEXT,
  created_at   INTEGER NOT NULL
);
-- 这条唯一索引就是「每人只能投一次」：并发下也不会重复，不靠业务代码判断
CREATE UNIQUE INDEX IF NOT EXISTS ux_votes_poll_user ON votes(poll_id, user_id);
CREATE INDEX IF NOT EXISTS ix_votes_user ON votes(user_id, created_at DESC);

-- 参与记录：谁把这条投票/问卷带给了我。
-- 分享卡片 / 小程序码落地时写一行，首页「待我投票」和邀请统计都靠它。
-- 同一个人对同一份投票只记一次（UNIQUE）；inviter_id 为空表示只是打开了链接。
CREATE TABLE IF NOT EXISTS invites (
  id          TEXT PRIMARY KEY,
  poll_id     TEXT NOT NULL,
  inviter_id  TEXT,
  invitee_id  TEXT NOT NULL,
  code        TEXT,
  created_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_invites_poll_invitee ON invites(poll_id, invitee_id);
CREATE INDEX IF NOT EXISTS ix_invites_invitee ON invites(invitee_id, created_at DESC);

-- 问卷回答。seq 支持「允许重复提交」：同一个人第 2 次提交就是 seq=2
CREATE TABLE IF NOT EXISTS answers (
  id           TEXT PRIMARY KEY,
  poll_id      TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  seq          INTEGER NOT NULL DEFAULT 1,
  content      TEXT NOT NULL,
  profile_info TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_answers_poll_user_seq ON answers(poll_id, user_id, seq);
CREATE INDEX IF NOT EXISTS ix_answers_poll ON answers(poll_id, created_at DESC);

-- ------------------------------------------------------------
-- 汇总（问卷 → 投票）
--
-- 归并结果必须落库：编辑选项、归入已有、忽略、重新归并这些操作
-- 都要跨页面/跨次访问保留，不能靠前端内存。
-- 单独建表而不是给 answers 加列，是因为 ALTER TABLE 没法写成
-- IF NOT EXISTS，老库重跑 schema.sql 会直接报错。
-- ------------------------------------------------------------

-- 汇总出来的候选选项
CREATE TABLE IF NOT EXISTS summary_options (
  id         TEXT PRIMARY KEY,
  poll_id    TEXT NOT NULL,
  title      TEXT NOT NULL,
  desc       TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_summary_options_poll ON summary_options(poll_id, sort);

-- 每条回答归到哪个选项；没有行 = 还没处理过（首次访问时自动分组）
CREATE TABLE IF NOT EXISTS summary_assignments (
  answer_id  TEXT PRIMARY KEY,
  poll_id    TEXT NOT NULL,
  option_id  TEXT,                          -- NULL = 未归类
  ignored    INTEGER NOT NULL DEFAULT 0,    -- 1 = 不参与这次汇总
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_summary_assign_poll ON summary_assignments(poll_id, option_id);

-- ------------------------------------------------------------
-- 评论（26 投票讨论区 / 79 问卷讨论区）
--
-- 只做一层回复：reply_to_id 指向被回复的那条评论，不建树。
-- 删除用软删除，否则 polls.comment_count 和列表里的楼层会一起错乱。
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  poll_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  content     TEXT NOT NULL,
  reply_to_id TEXT,
  like_count  INTEGER NOT NULL DEFAULT 0,
  deleted_at  INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_comments_poll ON comments(poll_id, created_at DESC);

-- 点过赞的人。(comment_id, user_id) 主键 = 同一个人只能点一次
CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);

-- ------------------------------------------------------------
-- 站内通知（44 消息通知）
--
-- 只做站内列表，不接微信订阅消息：推送到用户手机上需要模板 ID 和
-- 每次的订阅授权，开发阶段没有模板，做了也发不出去。
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,                 -- 收件人
  kind       TEXT NOT NULL,                 -- deadline | comment | result | joined | published
  title      TEXT NOT NULL,
  content    TEXT,
  poll_id    TEXT,                          -- 点进去落到哪
  actor_id   TEXT,                          -- 触发这件事的人
  read_at    INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_notifications_user ON notifications(user_id, created_at DESC);

-- 「提醒我」：截止后给点了提醒的人发一条。
-- 没有定时任务，截止后第一次拉通知列表时补发（flushDueReminders），
-- 这样本地开发不用等 cron 也能验证。
CREATE TABLE IF NOT EXISTS poll_reminders (
  poll_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (poll_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_poll_reminders_user ON poll_reminders(user_id);

-- ------------------------------------------------------------
-- 反馈（58 帮助与反馈）
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS feedback (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,                          -- 允许未登录提交，所以可空
  content    TEXT NOT NULL,
  contact    TEXT,
  created_at INTEGER NOT NULL
);

-- ------------------------------------------------------------
-- 微信 access_token 缓存
--
-- access_token 有调用频率限制（每天 2000 次左右），必须缓存复用。
-- Worker 没有跨请求的内存，所以放 D1；提前 60 秒过期，避免边界上拿到旧 token。
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wx_tokens (
  key        TEXT PRIMARY KEY,              -- 目前只有 'default'
  value      TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- ------------------------------------------------------------
-- 微信订阅消息
--
-- 订阅消息是「一次授权、一条消息」：用户在小程序里点一次同意，
-- 服务端就多一次发送机会，发完就没了。remaining 记的就是这个额度。
-- 额度不用持久化太多 —— 上限 3 条，够覆盖「有人参与 / 评论 / 截止」几条提醒。
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wx_subscriptions (
  user_id     TEXT NOT NULL,
  template_id TEXT NOT NULL,
  remaining   INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, template_id)
);

-- 推送偏好。设置页的开关原本只存在手机本地，但订阅消息是服务端发起的，
-- 本地开关拦不住，所以参与推送的类型要同步一份到服务端。
CREATE TABLE IF NOT EXISTS wx_push_prefs (
  user_id    TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL DEFAULT 1,
  joined     INTEGER NOT NULL DEFAULT 1,
  comment    INTEGER NOT NULL DEFAULT 1,
  deadline   INTEGER NOT NULL DEFAULT 1,
  result     INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
