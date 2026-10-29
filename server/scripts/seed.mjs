/**
 * 本地开发种子数据
 *
 * 目标：打开小程序就能看到非空列表，能走完「发起 → 参与 → 查看数据 → 汇总」。
 *
 *   npm run seed
 *
 * 只写本地 D1（--local）。所有 id 以 seed 开头，重复执行会先把上一批删掉再灌，
 * 不会碰真实账号（你自己登录的那个账号也保留）。
 *
 * 种子账号可以配合 DEV_LOGIN=true 在「设置 · 关于我们」长按切换：
 *   林小满 = 发起人视角（有投票、问卷、评论、通知）
 *   周子墨 / 陈一 / 林夏 = 参与者视角
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const now = Date.now()
const HOUR = 3_600_000
const DAY = 24 * HOUR
const ago = (ms) => now - ms
const later = (ms) => now + ms

/** SQL 字面量：字符串手动转义单引号，数字直接写，null 写 NULL */
const q = (v) =>
  v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`

const rows = []
const insert = (table, cols, values) =>
  rows.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${values.map(q).join(', ')})`)

/* ---------------- 账号 ---------------- */

const users = [
  { id: 'seed_u_alice', name: '林小满', bio: '这个人很懒，什么都没写', joined: 120 * DAY },
  { id: 'seed_u_zhou', name: '周子墨', bio: '周末只想躺平', joined: 90 * DAY },
  { id: 'seed_u_chen', name: '陈一', bio: '骑行爱好者', joined: 60 * DAY },
  { id: 'seed_u_lin', name: '林夏', bio: '', joined: 30 * DAY }
]
// 凑人数用：让票数和回答数的量级像真的
for (let i = 1; i <= 24; i++) {
  users.push({
    id: `seed_u_v${String(i).padStart(2, '0')}`,
    name: `用户${String(i).padStart(3, '0')}`,
    bio: '',
    joined: (40 - i) * DAY
  })
}

for (const u of users) {
  const at = ago(u.joined)
  insert(
    'users',
    ['id', 'nickname', 'avatar', 'bio', 'status', 'created_at', 'updated_at'],
    [u.id, u.name, null, u.bio || null, 0, at, at]
  )
}

const voters = users.filter((u) => u.id.startsWith('seed_u_v')).map((u) => u.id)

/* ---------------- 投票 / 问卷 ---------------- */

function poll(p) {
  insert(
    'polls',
    [
      'id', 'creator_id', 'type', 'title', 'desc', 'status', 'deleted_at',
      'created_at', 'end_at',
      'anonymous', 'allow_edit', 'allow_share', 'allow_comment', 'allow_repeat',
      'limit_ip', 'max_choice', 'result_visibility', 'shuffle_options',
      'hide_voter_count', 'join_method', 'invite_code', 'profile_field',
      'voter_count', 'answer_count', 'comment_count', 'view_count',
      'source_survey_id'
    ],
    [
      p.id, p.creator, p.type, p.title, p.desc ?? null, p.status ?? 0, null,
      p.createdAt, p.endAt,
      p.anonymous ?? 1, p.allowEdit ?? 0, 1, p.allowComment ?? 1, 0,
      0, p.maxChoice ?? 1, 'after_vote', 0,
      0, p.joinMethod ?? 'link', p.inviteCode ?? null, null,
      p.voterCount ?? 0, p.answerCount ?? 0, p.commentCount ?? 0, p.viewCount ?? 0,
      p.sourceSurveyId ?? null
    ]
  )
  ;(p.options ?? []).forEach((o, i) =>
    insert('options', ['id', 'poll_id', 'title', 'desc', 'sort', 'votes_count'], [
      o.id, p.id, o.title, o.desc ?? null, i, o.votes
    ])
  )
}

/** 一条投票记录：optionIds 会被写成 JSON 数组，和线上格式一致 */
function vote(pollId, userId, optionIds, at) {
  insert(
    'votes',
    ['id', 'poll_id', 'user_id', 'option_ids', 'profile_info', 'ip', 'created_at'],
    [`seed_v_${pollId.replace('seed_p_', '')}_${userId.replace('seed_u_', '')}`,
      pollId, userId, JSON.stringify(optionIds), null, null, at]
  )
}

function answer(pollId, userId, seq, content, at) {
  insert(
    'answers',
    ['id', 'poll_id', 'user_id', 'seq', 'content', 'profile_info', 'created_at', 'updated_at'],
    [`seed_a_${pollId.replace('seed_s_', '')}_${userId.replace('seed_u_', '')}_${seq}`,
      pollId, userId, seq, content, null, at, at]
  )
}

/** 参与记录：谁把这条投票带给了谁（首页「待我投票」读这张表） */
function invite(pollId, inviterId, inviteeId, code, at) {
  insert(
    'invites',
    ['id', 'poll_id', 'inviter_id', 'invitee_id', 'code', 'created_at'],
    [`seed_iv_${pollId.replace('seed_p_', '')}_${inviteeId.replace('seed_u_', '')}`,
      pollId, inviterId, inviteeId, code ?? null, at]
  )
}

function comment(id, pollId, userId, content, likeCount, at) {
  insert(
    'comments',
    ['id', 'poll_id', 'user_id', 'content', 'reply_to_id', 'like_count', 'deleted_at', 'created_at'],
    [id, pollId, userId, content, null, likeCount, null, at]
  )
}

/* --- 1. 团建地点（进行中，多人在投） --- */
{
  const opts = ['安吉竹海', '千岛湖骑行', '莫干山民宿', '本地聚餐']
  const ids = opts.map((_, i) => `seed_o_trip_${i + 1}`)

  // 每人一票，所以票数必须等于投票行数 —— 不手写假数字，先算再写
  const plan = voters.map((u, i) => ({
    userId: u,
    optionIds: [i < 11 ? ids[0] : i < 19 ? ids[1] : i < 23 ? ids[2] : ids[3]],
    at: ago(3 * DAY - i * 2 * HOUR)
  }))
  // 另外 3 个主账号也参与（发起人不投自己的，保持真实）
  plan.push({ userId: 'seed_u_zhou', optionIds: [ids[0]], at: ago(2 * DAY) })
  plan.push({ userId: 'seed_u_chen', optionIds: [ids[1]], at: ago(1.5 * DAY) })
  plan.push({ userId: 'seed_u_lin', optionIds: [ids[2]], at: ago(1 * DAY) })

  const counts = ids.map((id) => plan.filter((p) => p.optionIds.includes(id)).length)
  poll({
    id: 'seed_p_trip',
    creator: 'seed_u_alice',
    type: 'single',
    title: '下季度团建去哪里',
    desc: '四个选项，选一个最想去的，周末两天一夜',
    createdAt: ago(3 * DAY),
    endAt: later(4 * DAY),
    voterCount: plan.length,
    commentCount: 3,
    options: opts.map((title, i) => ({ id: ids[i], title, votes: counts[i] }))
  })
  for (const p of plan) vote('seed_p_trip', p.userId, p.optionIds, p.at)

  comment('seed_c_trip_1', 'seed_p_trip', 'seed_u_zhou', '安吉的竹林晚上会冷，记得带外套', 12, ago(2 * DAY))
  comment('seed_c_trip_2', 'seed_p_trip', 'seed_u_chen', '千岛湖骑行强度会不会太大？', 8, ago(1 * DAY))
  comment('seed_c_trip_3', 'seed_p_trip', 'seed_u_lin', '莫干山去过一次，民宿条件确实不错，晚上还能看星星。', 5, ago(20 * HOUR))
}

/* --- 2. 部门之星（多选，进行中） --- */
{
  const names = ['周子墨', '陈一', '林夏']
  const ids = names.map((_, i) => `seed_o_star_${i + 1}`)
  const plan = [
    ...voters.slice(0, 10).map((u, i) => ({ userId: u, optionIds: [ids[i % 3]], at: ago(2 * DAY - i * HOUR) })),
    ...voters.slice(10, 16).map((u, i) => ({ userId: u, optionIds: [ids[0], ids[1]], at: ago(1 * DAY - i * HOUR) }))
  ]
  const counts = ids.map((id) => plan.filter((p) => p.optionIds.includes(id)).length)
  poll({
    id: 'seed_p_star',
    creator: 'seed_u_alice',
    type: 'multiple',
    maxChoice: 2,
    allowEdit: 1,
    title: '部门月度之星评选',
    desc: '可以选两位，投票截止后公布结果',
    createdAt: ago(2 * DAY),
    endAt: later(5 * DAY),
    voterCount: plan.length,
    options: names.map((title, i) => ({ id: ids[i], title, votes: counts[i] }))
  })
  for (const p of plan) vote('seed_p_star', p.userId, p.optionIds, p.at)
}

/* --- 3. 本周午餐（进行中，周子墨发起，林小满参与过） --- */
{
  const ids = ['seed_o_lunch_1', 'seed_o_lunch_2']
  const plan = [
    { userId: 'seed_u_alice', optionIds: [ids[0]], at: ago(6 * HOUR) },
    ...voters.slice(0, 8).map((u, i) => ({ userId: u, optionIds: [i % 2 ? ids[0] : ids[1]], at: ago(8 * HOUR - i * 1000) }))
  ]
  const counts = ids.map((id) => plan.filter((p) => p.optionIds.includes(id)).length)
  poll({
    id: 'seed_p_lunch',
    creator: 'seed_u_zhou',
    type: 'single',
    title: '本周午餐怎么解决',
    desc: '楼下食堂还是点外卖，中午 12 点截止',
    createdAt: ago(9 * HOUR),
    endAt: later(2 * DAY),
    voterCount: plan.length,
    options: [
      { id: ids[0], title: '楼下食堂', votes: counts[0] },
      { id: ids[1], title: '一起点外卖', votes: counts[1] }
    ]
  })
  for (const p of plan) vote('seed_p_lunch', p.userId, p.optionIds, p.at)
}

/* --- 4. 年会节目（已结束，发起人视角能看结果） --- */
{
  const names = ['唱歌', '小品', '不表演']
  const ids = names.map((_, i) => `seed_o_gala_${i + 1}`)
  const plan = voters.slice(0, 12).map((u, i) => ({ userId: u, optionIds: [ids[i % 3]], at: ago(4 * DAY - i * HOUR) }))
  const counts = ids.map((id) => plan.filter((p) => p.optionIds.includes(id)).length)
  poll({
    id: 'seed_p_gala',
    creator: 'seed_u_alice',
    type: 'single',
    status: 1,
    title: '年会节目征集',
    desc: '已经截止，结果可以查看',
    createdAt: ago(6 * DAY),
    endAt: ago(2 * DAY),
    voterCount: plan.length,
    options: names.map((title, i) => ({ id: ids[i], title, votes: counts[i] }))
  })
  for (const p of plan) vote('seed_p_gala', p.userId, p.optionIds, p.at)
}

/* --- 4.5 下午茶（进行中，邀请码模式，周子墨发起） --- */
{
  const names = ['奶茶', '咖啡', '水果茶']
  const ids = names.map((_, i) => `seed_o_tea_${i + 1}`)
  const plan = voters.slice(0, 6).map((u, i) => ({
    userId: u,
    optionIds: [ids[i % 3]],
    at: ago(5 * HOUR - i * 10 * 60 * 1000)
  }))
  const counts = ids.map((id) => plan.filter((p) => p.optionIds.includes(id)).length)
  poll({
    id: 'seed_p_tea',
    creator: 'seed_u_zhou',
    type: 'single',
    title: '周五下午茶喝什么',
    desc: '只发给受邀的同事，凭邀请码参与',
    createdAt: ago(6 * HOUR),
    endAt: later(2 * DAY),
    voterCount: plan.length,
    joinMethod: 'invite',
    inviteCode: 'TEA238',
    options: names.map((title, i) => ({ id: ids[i], title, votes: counts[i] }))
  })
  // 林小满收到邀请但还没投 —— 首页「待我投票」就是它
  invite('seed_p_tea', 'seed_u_zhou', 'seed_u_alice', 'TEA238', ago(5 * HOUR))
  for (const p of plan) {
    vote('seed_p_tea', p.userId, p.optionIds, p.at)
    invite('seed_p_tea', 'seed_u_zhou', p.userId, 'TEA238', p.at - 5 * 60 * 1000)
  }
}

/* --- 5. 团建建议（问卷，已截止，可汇总） --- */
{
  // 现在的自动归并只按「内容完全相同」分组，所以这里故意让选项名重复出现，
  // 才能演示出 84 的候选选项（3 / 2 / 2）和 1 条未归类。
  const contents = [
    ['seed_u_zhou', '安吉竹海'],
    ['seed_u_chen', '千岛湖骑行'],
    ['seed_u_lin', '莫干山民宿'],
    ['seed_u_v01', '安吉竹海'],
    ['seed_u_v02', '千岛湖骑行'],
    ['seed_u_v03', '莫干山民宿'],
    ['seed_u_v04', '安吉竹海'],
    ['seed_u_v05', '希望预算控制在人均 500 以内']
  ]
  poll({
    id: 'seed_s_team',
    creator: 'seed_u_alice',
    type: 'survey',
    status: 1,
    title: '关于下季度团建的建议',
    desc: '随便说说想去哪、想玩什么，截止后我会整理成投票',
    createdAt: ago(8 * DAY),
    endAt: ago(1 * DAY),
    answerCount: contents.length
  })
  contents.forEach(([u, text], i) => answer('seed_s_team', u, 1, text, ago(7 * DAY - i * 3 * HOUR)))
}

/* --- 6. 预算分配（问卷，进行中，林小满已经填过） --- */
{
  const contents = [
    ['seed_u_alice', '交通 40%，住宿 40%，吃喝 20%'],
    ['seed_u_v06', '住宿可以省一点，多留点给活动'],
    ['seed_u_v07', '希望有下午茶预算']
  ]
  poll({
    id: 'seed_s_budget',
    creator: 'seed_u_zhou',
    type: 'survey',
    title: '团建预算怎么分配？',
    desc: '总预算 2 万，三个问题：交通、住宿、吃喝',
    createdAt: ago(2 * DAY),
    endAt: later(3 * DAY),
    answerCount: contents.length
  })
  contents.forEach(([u, text], i) => answer('seed_s_budget', u, 1, text, ago(1 * DAY - i * 2 * HOUR)))
}

/* ---------------- 消息 ---------------- */

function notification(id, userId, kind, title, content, pollId, createdAt, read) {
  insert(
    'notifications',
    ['id', 'user_id', 'kind', 'title', 'content', 'poll_id', 'actor_id', 'read_at', 'created_at'],
    [id, userId, kind, title, content, pollId, null, read ? createdAt + 10 * 60 * 1000 : null, createdAt]
  )
}

notification('seed_n_1', 'seed_u_alice', 'joined', '有人参与了你的投票', '周子墨 在「下季度团建去哪里」投了一票', 'seed_p_trip', ago(2 * DAY), false)
notification('seed_n_2', 'seed_u_alice', 'comment', '新的评论', '陈一 评论了「下季度团建去哪里」：千岛湖骑行强度会不会太大？', 'seed_p_trip', ago(1 * DAY), false)
notification('seed_n_3', 'seed_u_alice', 'joined', '收到新的回答', '用户005 提交了「关于下季度团建的建议」的回答：千岛湖骑行不错…', 'seed_s_team', ago(4 * DAY), true)

// 给林小满留一条未到期的提醒：种子里的已结束投票会在第一次拉通知列表时补发
insert('poll_reminders', ['poll_id', 'user_id', 'created_at'], ['seed_p_gala', 'seed_u_alice', ago(3 * DAY)])

/* ---------------- 清理 + 写入 ---------------- */

// 先删上一批种子数据，再灌新的；只按 seed 前缀删，不碰真实账号。
//
// 子表要按 poll_id 删，不能只按自身 id：开发时在种子投票上真投过一票、
// 发过一条评论，那些 id 是运行时生成的，不带 seed 前缀。只按 id 删的话，
// 票会留在新灌的选项旁边 —— 发起人明明还没被投过，却显示已投。
const cleanup = [
  "DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE id LIKE 'seed%' OR poll_id LIKE 'seed%')",
  "DELETE FROM comments WHERE id LIKE 'seed%' OR poll_id LIKE 'seed%'",
  "DELETE FROM notifications WHERE id LIKE 'seed%' OR user_id LIKE 'seed%'",
  "DELETE FROM poll_reminders WHERE poll_id LIKE 'seed%'",
  "DELETE FROM summary_assignments WHERE poll_id LIKE 'seed%'",
  "DELETE FROM summary_options WHERE poll_id LIKE 'seed%'",
  "DELETE FROM answers WHERE id LIKE 'seed%' OR poll_id LIKE 'seed%'",
  "DELETE FROM votes WHERE id LIKE 'seed%' OR poll_id LIKE 'seed%'",
  "DELETE FROM options WHERE id LIKE 'seed%' OR poll_id LIKE 'seed%'",
  "DELETE FROM invites WHERE id LIKE 'seed%' OR poll_id LIKE 'seed%'",
  "DELETE FROM polls WHERE id LIKE 'seed%'",
  "DELETE FROM feedback WHERE id LIKE 'seed%'",
  "DELETE FROM users WHERE id LIKE 'seed%'"
]

const sql = [...cleanup, ...rows].join(';\n') + ';\n'

const file = '.seed.sql'
fs.writeFileSync(file, sql)
try {
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'duyaxuan-db', '--local', `--file=${file}`],
    { stdio: 'inherit', shell: process.platform === 'win32' }
  )
} finally {
  fs.rmSync(file, { force: true })
}

console.log(`\n✅ 种子数据已写入：${users.length} 个账号、7 个投票/问卷`)
console.log('   林小满 seed_u_alice / 周子墨 seed_u_zhou / 陈一 seed_u_chen / 林夏 seed_u_lin')
