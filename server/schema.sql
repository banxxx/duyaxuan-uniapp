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
  join_method       TEXT NOT NULL DEFAULT 'link',
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
