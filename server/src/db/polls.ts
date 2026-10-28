/**
 * 投票 / 问卷的读写
 *
 * 所有 SQL 都在这个文件里，路由层只调函数。将来要换数据库
 * （比如迁到 MySQL 或 Supabase）只改 db/ 这一层。
 */

import type {
  AnswerRow,
  OptionRow,
  Paged,
  PollOptionOut,
  PollOut,
  PollRow,
  PollRowJoined,
  PollStatusFilter,
  PollType
} from '../types'
import { newId } from '../lib/id'
import { HttpError } from '../lib/response'

const PAGE_SIZE = 20
const DAY_MS = 86_400_000
/** 东八区偏移：统计「今天新增」「按小时分布」都要按中国时区切 */
const TZ_OFFSET = 8 * 3_600_000

/* ============================================================
 * 行 → 前端对象
 * ============================================================ */

function toPoll(
  row: PollRowJoined,
  options: OptionRow[],
  mine?: { optionIds?: string[]; answered?: boolean }
): PollOut {
  const type = row.type as PollType
  const isSurvey = type === 'survey'

  const poll: PollOut = {
    id: row.id,
    type,
    title: row.title,
    desc: row.desc ?? undefined,
    creatorId: row.creator_id,
    creatorName: row.creator_name ?? '已注销用户',
    creatorAvatar: row.creator_avatar ?? undefined,
    createdAt: row.created_at,
    rules: {
      anonymous: !!row.anonymous,
      allowEdit: !!row.allow_edit,
      allowShare: !!row.allow_share,
      allowComment: !!row.allow_comment,
      limitIp: !!row.limit_ip,
      joinMethod: row.join_method,
      profileField: row.profile_field,
      endAt: row.end_at
    },
    options: options.map<PollOptionOut>((o) => ({
      id: o.id,
      title: o.title,
      desc: o.desc ?? undefined,
      votes: o.votes_count
    })),
    voterCount: row.voter_count,
    commentCount: row.comment_count,
    viewCount: row.view_count
  }

  if (isSurvey) {
    poll.answerCount = row.answer_count
    poll.rules.allowRepeat = !!row.allow_repeat
  } else {
    poll.rules.maxChoice = row.max_choice
    poll.rules.resultVisibility = row.result_visibility
    poll.rules.shuffleOptions = !!row.shuffle_options
    poll.rules.hideVoterCount = !!row.hide_voter_count
  }

  if (row.source_survey_id) poll.sourceSurveyId = row.source_survey_id
  if (row.deleted_at) poll.deletedAt = row.deleted_at

  // 「我投了：安吉」「N 项」—— 列表行要显示，后端一次算好，
  // 避免列表每行再单独查一次我的选择
  const mineIds = mine?.optionIds ?? []
  if (mineIds.length) {
    const chosen = poll.options.filter((o) => mineIds.includes(o.id))
    poll.myChoiceCount = chosen.length
    poll.myChoice = chosen.length > 1 ? `${chosen.length} 项` : chosen[0]?.title
  }
  if (isSurvey) poll.myAnswered = !!mine?.answered

  return poll
}

/**
 * 批量补全：选项 + 我的选择 + 我是否答过。
 *
 * 用 IN (...) 一次查完当页所有投票，避免 N+1。
 */
async function hydrate(
  db: D1Database,
  rows: PollRowJoined[],
  viewerId?: string | null
): Promise<PollOut[]> {
  if (!rows.length) return []

  const ids = rows.map((r) => r.id)
  const marks = ids.map(() => '?').join(',')

  const optRes = await db
    .prepare(`SELECT * FROM options WHERE poll_id IN (${marks}) ORDER BY sort, id`)
    .bind(...ids)
    .all<OptionRow>()

  const optionsByPoll = new Map<string, OptionRow[]>()
  for (const o of optRes.results) {
    const arr = optionsByPoll.get(o.poll_id)
    if (arr) arr.push(o)
    else optionsByPoll.set(o.poll_id, [o])
  }

  const myVotes = new Map<string, string[]>()
  const answered = new Set<string>()

  if (viewerId) {
    const voteRes = await db
      .prepare(`SELECT poll_id, option_ids FROM votes WHERE user_id = ? AND poll_id IN (${marks})`)
      .bind(viewerId, ...ids)
      .all<{ poll_id: string; option_ids: string }>()
    for (const v of voteRes.results) {
      myVotes.set(v.poll_id, parseIds(v.option_ids))
    }

    const ansRes = await db
      .prepare(
        `SELECT DISTINCT poll_id FROM answers WHERE user_id = ? AND poll_id IN (${marks})`
      )
      .bind(viewerId, ...ids)
      .all<{ poll_id: string }>()
    for (const a of ansRes.results) answered.add(a.poll_id)
  }

  return rows.map((row) =>
    toPoll(row, optionsByPoll.get(row.id) ?? [], {
      optionIds: myVotes.get(row.id),
      answered: answered.has(row.id)
    })
  )
}

/** option_ids 是 JSON 数组；脏数据不能把整个列表打挂 */
export function parseIds(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/* ============================================================
 * 查询
 * ============================================================ */

const SELECT_JOINED = `SELECT p.*, u.nickname AS creator_name, u.avatar AS creator_avatar
  FROM polls p LEFT JOIN users u ON u.id = p.creator_id`

function statusClause(status: PollStatusFilter, now: number): { sql: string; params: number[] } {
  if (status === 'ongoing') return { sql: ' AND p.status = 0 AND p.end_at > ?', params: [now] }
  if (status === 'ended') return { sql: ' AND (p.status = 1 OR p.end_at <= ?)', params: [now] }
  return { sql: '', params: [] }
}

interface ListArgs {
  where: string
  params: (string | number | null)[]
  viewerId?: string | null
  cursor?: string | null
  order?: string
}

async function listPolls(db: D1Database, args: ListArgs): Promise<Paged<PollOut>> {
  const offset = Math.max(0, Number(args.cursor) || 0)

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM polls p WHERE ${args.where}`)
    .bind(...args.params)
    .first<{ n: number }>()
  const total = countRow?.n ?? 0
  if (!total) return { list: [], cursor: null, hasMore: false, total: 0 }

  const { results } = await db
    .prepare(
      `${SELECT_JOINED} WHERE ${args.where} ORDER BY ${args.order ?? 'p.created_at DESC'} LIMIT ? OFFSET ?`
    )
    .bind(...args.params, PAGE_SIZE, offset)
    .all<PollRowJoined>()

  const list = await hydrate(db, results, args.viewerId)
  const next = offset + list.length
  return { list, cursor: next < total ? String(next) : null, hasMore: next < total, total }
}

export async function listMine(
  db: D1Database,
  userId: string,
  status: PollStatusFilter,
  cursor?: string | null
): Promise<Paged<PollOut>> {
  const s = statusClause(status, Date.now())
  return listPolls(db, {
    where: `p.creator_id = ? AND p.deleted_at IS NULL${s.sql}`,
    params: [userId, ...s.params],
    viewerId: userId,
    cursor
  })
}

/**
 * 我参与的：我投过票或答过卷的，且不是我自己发起的。
 * 用 EXISTS 而不是 JOIN votes —— 一份问卷允许重复提交，JOIN 会把同一份投票
 * 在列表里出现多次。
 */
export async function listJoined(
  db: D1Database,
  userId: string,
  status: PollStatusFilter,
  cursor?: string | null
): Promise<Paged<PollOut>> {
  const s = statusClause(status, Date.now())
  return listPolls(db, {
    where: `p.deleted_at IS NULL AND p.creator_id != ?
      AND (EXISTS (SELECT 1 FROM votes v WHERE v.poll_id = p.id AND v.user_id = ?)
        OR EXISTS (SELECT 1 FROM answers a WHERE a.poll_id = p.id AND a.user_id = ?))${s.sql}`,
    params: [userId, userId, userId, ...s.params],
    viewerId: userId,
    cursor
  })
}

export async function listDiscover(
  db: D1Database,
  viewerId: string | null,
  status: PollStatusFilter,
  cursor?: string | null
): Promise<Paged<PollOut>> {
  const s = statusClause(status, Date.now())
  return listPolls(db, {
    // 私密投票不出现在发现页
    where: `p.deleted_at IS NULL AND p.join_method != 'private'${s.sql}`,
    params: s.params,
    viewerId,
    cursor
  })
}

/**
 * 02 首页 · 待我投票
 *
 * 真正的「待我投票」应该来自邀请记录（谁分享给了我）。目前没有分享落库，
 * 先用「进行中、不是我发起的、我还没投」按截止时间由近到远取前几条顶上。
 * 等做了分享链路，把这里换成 invites 表的联表查询即可。
 */
export async function listPending(db: D1Database, userId: string, limit = 5) {
  const now = Date.now()
  const { results } = await db
    .prepare(
      `${SELECT_JOINED}
       WHERE p.deleted_at IS NULL
         AND p.status = 0 AND p.end_at > ?
         AND p.type != 'survey'
         AND p.creator_id != ?
         AND NOT EXISTS (SELECT 1 FROM votes v WHERE v.poll_id = p.id AND v.user_id = ?)
       ORDER BY p.end_at ASC
       LIMIT ?`
    )
    .bind(now, userId, userId, limit)
    .all<PollRowJoined>()

  return results.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type as 'single' | 'multiple',
    inviterName: r.creator_name ?? '已注销用户',
    voterCount: r.voter_count,
    anonymous: !!r.anonymous,
    maxChoice: r.max_choice,
    endAt: r.end_at
  }))
}

export async function searchPolls(
  db: D1Database,
  viewerId: string | null,
  keyword: string
): Promise<PollOut[]> {
  const kw = keyword.trim()
  if (!kw) return []
  const like = `%${kw.replace(/[%_]/g, (m) => `\\${m}`)}%`
  const { results } = await db
    .prepare(
      `${SELECT_JOINED}
       WHERE p.deleted_at IS NULL AND (p.title LIKE ? ESCAPE '\\' OR p.desc LIKE ? ESCAPE '\\')
       ORDER BY p.created_at DESC LIMIT 30`
    )
    .bind(like, like)
    .all<PollRowJoined>()
  return hydrate(db, results, viewerId)
}

export async function findPollRow(
  db: D1Database,
  id: string
): Promise<PollRowJoined | null> {
  return (
    (await db.prepare(`${SELECT_JOINED} WHERE p.id = ?`).bind(id).first<PollRowJoined>()) ?? null
  )
}

/** 读详情。软删除的只有发起人自己能看到（回收站里恢复用） */
export async function getPoll(
  db: D1Database,
  id: string,
  viewerId?: string | null
): Promise<PollOut> {
  const row = await findPollRow(db, id)
  if (!row) throw new HttpError(404, '投票不存在')
  if (row.deleted_at && row.creator_id !== viewerId) throw new HttpError(404, '投票不存在')

  const [poll] = await hydrate(db, [row], viewerId)
  return poll
}

export async function bumpViewCount(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE polls SET view_count = view_count + 1 WHERE id = ?').bind(id).run()
}

/* ============================================================
 * 写入
 * ============================================================ */

interface RulesInput {
  anonymous?: boolean
  allowEdit?: boolean
  allowShare?: boolean
  limitIp?: boolean
  allowComment?: boolean
  allowRepeat?: boolean
  maxChoice?: number
  resultVisibility?: string
  shuffleOptions?: boolean
  hideVoterCount?: boolean
  joinMethod?: string
  profileField?: string | null
  endAt?: number
}

export interface PollBody {
  type?: string
  title?: string
  desc?: string
  options?: Array<{ id?: string; title?: string; desc?: string }>
  rules?: RulesInput
  sourceSurveyId?: string
}

const RESULT_VISIBILITIES = ['always', 'after_vote', 'after_end', 'hidden']
const JOIN_METHODS = ['link', 'group', 'private']
const MAX_OPTIONS = 20

function normalizeType(raw: string | undefined): PollType {
  return raw === 'survey' || raw === 'multiple' ? raw : 'single'
}

function normalizeTitle(raw: string | undefined): string {
  const title = (raw ?? '').trim()
  if (!title) throw new HttpError(400, '请填写标题')
  if (title.length > 60) throw new HttpError(400, '标题最多 60 字')
  return title
}

/** 规则平铺成列。非法值一律回落到默认，而不是报错 —— 前端表单不该能提交脏值 */
function normalizeRules(input: RulesInput | undefined, type: PollType, fallbackEndAt: number) {
  const r = input ?? {}
  const maxChoice =
    type === 'multiple' ? Math.min(9, Math.max(2, Math.trunc(Number(r.maxChoice) || 2))) : 1
  const endAt = Number(r.endAt)

  return {
    anonymous: r.anonymous === false ? 0 : 1,
    allowEdit: r.allowEdit ? 1 : 0,
    allowShare: r.allowShare === false ? 0 : 1,
    allowComment: r.allowComment === false ? 0 : 1,
    allowRepeat: type === 'survey' && r.allowRepeat ? 1 : 0,
    limitIp: r.limitIp ? 1 : 0,
    maxChoice,
    resultVisibility:
      type !== 'survey' && RESULT_VISIBILITIES.includes(r.resultVisibility ?? '')
        ? (r.resultVisibility as string)
        : 'after_vote',
    shuffleOptions: type !== 'survey' && r.shuffleOptions ? 1 : 0,
    hideVoterCount: type !== 'survey' && r.hideVoterCount ? 1 : 0,
    joinMethod: JOIN_METHODS.includes(r.joinMethod ?? '') ? (r.joinMethod as string) : 'link',
    profileField: r.profileField ? String(r.profileField).trim().slice(0, 20) : null,
    endAt: Number.isFinite(endAt) && endAt > 0 ? Math.trunc(endAt) : fallbackEndAt
  }
}

function cleanOptions(raw: PollBody['options']): Array<{ title: string; desc: string | null }> {
  const list = (raw ?? [])
    .map((o) => ({ title: (o.title ?? '').trim(), desc: (o.desc ?? '').trim() }))
    .filter((o) => o.title)
    .map((o) => ({ title: o.title.slice(0, 40), desc: o.desc.slice(0, 80) || null }))

  if (list.length > MAX_OPTIONS) throw new HttpError(400, `选项最多 ${MAX_OPTIONS} 个`)
  return list
}

export async function createPoll(
  db: D1Database,
  creatorId: string,
  body: PollBody
): Promise<PollOut> {
  const type = normalizeType(body.type)
  const title = normalizeTitle(body.title)
  const options = cleanOptions(body.options)

  if (type !== 'survey' && options.length < 2) throw new HttpError(400, '至少需要 2 个选项')

  const now = Date.now()
  const rules = normalizeRules(body.rules, type, now + 3 * DAY_MS)
  const pollId = newId('p')

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO polls (
           id, creator_id, type, title, desc, status, created_at, end_at,
           anonymous, allow_edit, allow_share, allow_comment, allow_repeat, limit_ip,
           max_choice, result_visibility, shuffle_options, hide_voter_count,
           join_method, profile_field, source_survey_id
         ) VALUES (?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        pollId,
        creatorId,
        type,
        title,
        (body.desc ?? '').trim().slice(0, 500) || null,
        now,
        rules.endAt,
        rules.anonymous,
        rules.allowEdit,
        rules.allowShare,
        rules.allowComment,
        rules.allowRepeat,
        rules.limitIp,
        rules.maxChoice,
        rules.resultVisibility,
        rules.shuffleOptions,
        rules.hideVoterCount,
        rules.joinMethod,
        rules.profileField,
        body.sourceSurveyId ?? null
      )
  ]

  options.forEach((o, i) => {
    stmts.push(
      db
        .prepare(
          'INSERT INTO options (id, poll_id, title, desc, sort, votes_count) VALUES (?,?,?,?,?,0)'
        )
        .bind(newId('o'), pollId, o.title, o.desc, i)
    )
  })

  // 投票 + 选项在同一个 batch 里，不会出现「有投票没选项」的半截数据
  await db.batch(stmts)
  return getPoll(db, pollId, creatorId)
}

export async function updatePoll(
  db: D1Database,
  pollId: string,
  userId: string,
  body: PollBody
): Promise<PollOut> {
  const row = await findPollRow(db, pollId)
  if (!row) throw new HttpError(404, '投票不存在')
  if (row.creator_id !== userId) throw new HttpError(403, '只有发起人可以编辑')
  if (row.deleted_at) throw new HttpError(400, '投票已删除，请先恢复')

  const type = row.type as PollType
  const title = normalizeTitle(body.title)
  const rules = normalizeRules(body.rules, type, row.end_at)
  const now = Date.now()

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE polls SET
           title = ?, desc = ?, end_at = ?,
           anonymous = ?, allow_edit = ?, allow_share = ?, allow_comment = ?,
           allow_repeat = ?, limit_ip = ?, max_choice = ?, result_visibility = ?,
           shuffle_options = ?, hide_voter_count = ?, join_method = ?, profile_field = ?
         WHERE id = ?`
      )
      .bind(
        title,
        (body.desc ?? '').trim().slice(0, 500) || null,
        rules.endAt,
        rules.anonymous,
        rules.allowEdit,
        rules.allowShare,
        rules.allowComment,
        rules.allowRepeat,
        rules.limitIp,
        rules.maxChoice,
        rules.resultVisibility,
        rules.shuffleOptions,
        rules.hideVoterCount,
        rules.joinMethod,
        rules.profileField,
        pollId
      )
  ]

  // 问卷没有选项；投票才处理选项增删改
  if (type !== 'survey' && Array.isArray(body.options)) {
    const next = cleanOptions(body.options)
    if (next.length < 2) throw new HttpError(400, '至少需要 2 个选项')

    const existing = await db
      .prepare('SELECT * FROM options WHERE poll_id = ?')
      .bind(pollId)
      .all<OptionRow>()
    const byId = new Map(existing.results.map((o) => [o.id, o]))

    const incoming = (body.options ?? []).filter((o) => (o.title ?? '').trim())
    const keptIds = new Set(incoming.map((o) => o.id).filter((id): id is string => !!id && byId.has(id)))

    // 已经有票的选项不能删 —— 删了那些票就凭空消失，别人看到的百分比会变
    const votedDropped = existing.results.filter((o) => !keptIds.has(o.id) && o.votes_count > 0)
    if (votedDropped.length) {
      throw new HttpError(400, `「${votedDropped[0].title}」已有票数，不能删除`)
    }

    let sort = 0
    for (const item of incoming) {
      const clean = next[sort] ?? { title: '', desc: null }
      if (item.id && byId.has(item.id)) {
        stmts.push(
          db
            .prepare('UPDATE options SET title = ?, desc = ?, sort = ? WHERE id = ?')
            .bind(clean.title, clean.desc, sort, item.id)
        )
      } else {
        stmts.push(
          db
            .prepare(
              'INSERT INTO options (id, poll_id, title, desc, sort, votes_count) VALUES (?,?,?,?,?,0)'
            )
            .bind(newId('o'), pollId, clean.title, clean.desc, sort)
        )
      }
      sort++
    }

    for (const o of existing.results) {
      if (!keptIds.has(o.id)) {
        stmts.push(db.prepare('DELETE FROM options WHERE id = ?').bind(o.id))
      }
    }
  }

  await db.batch(stmts)
  return getPoll(db, pollId, userId)
}

export async function softDeletePoll(
  db: D1Database,
  pollId: string,
  userId: string
): Promise<void> {
  const row = await findPollRow(db, pollId)
  if (!row) throw new HttpError(404, '投票不存在')
  if (row.creator_id !== userId) throw new HttpError(403, '只有发起人可以删除')
  await db
    .prepare('UPDATE polls SET deleted_at = ? WHERE id = ?')
    .bind(Date.now(), pollId)
    .run()
}

export async function restorePoll(
  db: D1Database,
  pollId: string,
  userId: string
): Promise<void> {
  const row = await findPollRow(db, pollId)
  if (!row) throw new HttpError(404, '投票不存在')
  if (row.creator_id !== userId) throw new HttpError(403, '只有发起人可以恢复')
  await db.prepare('UPDATE polls SET deleted_at = NULL WHERE id = ?').bind(pollId).run()
}

/** 提前结束：status 置 1 的同时把 end_at 收到现在，列表排序和「已过 X%」都对得上 */
export async function endPoll(db: D1Database, pollId: string, userId: string): Promise<void> {
  const row = await findPollRow(db, pollId)
  if (!row) throw new HttpError(404, '投票不存在')
  if (row.creator_id !== userId) throw new HttpError(403, '只有发起人可以结束')
  const now = Date.now()
  await db
    .prepare('UPDATE polls SET status = 1, end_at = ? WHERE id = ?')
    .bind(Math.min(now, row.end_at), pollId)
    .run()
}

export function assertPollOpen(row: PollRow): void {
  if (row.deleted_at) throw new HttpError(404, '投票不存在')
  if (row.status === 1 || row.end_at <= Date.now()) throw new HttpError(400, '投票已结束')
}

export async function getPollRowOrThrow(db: D1Database, pollId: string): Promise<PollRowJoined> {
  const row = await findPollRow(db, pollId)
  if (!row) throw new HttpError(404, '投票不存在')
  return row
}

/* ============================================================
 * 我发起的 · 汇总统计（首页顶部三块数字）
 * ============================================================ */

export async function myStats(db: D1Database, userId: string) {
  const now = Date.now()
  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 0 AND end_at > ? THEN 1 ELSE 0 END) AS ongoing,
         SUM(CASE WHEN status = 1 OR end_at <= ? THEN 1 ELSE 0 END) AS ended,
         COALESCE(SUM(voter_count), 0) AS voters
       FROM polls WHERE creator_id = ? AND deleted_at IS NULL`
    )
    .bind(now, now, userId)
    .first<{ ongoing: number | null; ended: number | null; voters: number }>()

  const voters = row?.voters ?? 0
  return [
    { value: row?.ongoing ?? 0, label: '进行中' },
    { value: row?.ended ?? 0, label: '已结束' },
    { value: voters >= 1000 ? `${(voters / 1000).toFixed(1)}k` : voters, label: '总参与' }
  ]
}

/* ============================================================
 * 24/25 发布者数据页
 * ============================================================ */

export async function pollStats(db: D1Database, pollId: string) {
  const row = await getPollRowOrThrow(db, pollId)
  const isSurvey = row.type === 'survey'
  const now = Date.now()
  const dayStart = Math.floor((now + TZ_OFFSET) / DAY_MS) * DAY_MS - TZ_OFFSET
  const weekStart = dayStart - 6 * DAY_MS

  // 投票看 votes，问卷看 answers；两张表列名一致，拼一个表名就够了
  const table = isSurvey ? 'answers' : 'votes'

  const [todayRow, latestRow, trendRes, hourRes, voteSumRow] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE poll_id = ? AND created_at >= ?`)
      .bind(pollId, dayStart)
      .first<{ n: number }>(),
    db
      .prepare(`SELECT MAX(created_at) AS t FROM ${table} WHERE poll_id = ?`)
      .bind(pollId)
      .first<{ t: number | null }>(),
    db
      .prepare(
        `SELECT CAST((created_at + ?) / ? AS INTEGER) AS d, COUNT(*) AS n
         FROM ${table} WHERE poll_id = ? AND created_at >= ?
         GROUP BY d`
      )
      .bind(TZ_OFFSET, DAY_MS, pollId, weekStart)
      .all<{ d: number; n: number }>(),
    db
      .prepare(
        `SELECT CAST(((created_at + ?) % ?) / 21600000 AS INTEGER) AS h, COUNT(*) AS n
         FROM ${table} WHERE poll_id = ? GROUP BY h`
      )
      .bind(TZ_OFFSET, DAY_MS, pollId)
      .all<{ h: number; n: number }>(),
    db
      .prepare('SELECT COALESCE(SUM(votes_count), 0) AS n FROM options WHERE poll_id = ?')
      .bind(pollId)
      .first<{ n: number }>()
  ])

  const byDay = new Map(trendRes.results.map((r) => [r.d, r.n]))
  const trend: Array<{ label: string; value: number }> = []
  for (let i = 0; i < 7; i++) {
    const dayIndex = Math.floor((weekStart + i * DAY_MS + TZ_OFFSET) / DAY_MS)
    const d = new Date(weekStart + i * DAY_MS + TZ_OFFSET)
    trend.push({
      label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
      value: byDay.get(dayIndex) ?? 0
    })
  }

  // h = 0-3 对应 0-6 / 6-12 / 12-18 / 18-24；展示顺序从上午开始，深夜放最后
  const HOUR_LABELS: Record<number, string> = {
    0: '深夜 0-6',
    1: '上午 6-12',
    2: '下午 12-18',
    3: '晚上 18-24'
  }
  const byHour = new Map(hourRes.results.map((r) => [r.h, r.n]))
  // 分母用「人数」而不是「票数」：多选时一个人投了 3 项，按票数算会让占比超过 100%
  const totalEntries = isSurvey ? row.answer_count : row.voter_count
  const hours = [1, 2, 3, 0].map((h) => {
    const value = byHour.get(h) ?? 0
    return {
      label: HOUR_LABELS[h],
      value,
      pct: totalEntries ? Math.round((value / totalEntries) * 100) : 0
    }
  })
  const peak = hours.reduce((a, b) => (b.value > a.value ? b : a), hours[0])

  const span = row.end_at - row.created_at
  const progress =
    span > 0 ? Math.min(100, Math.max(0, Math.round(((now - row.created_at) / span) * 100))) : 100

  return {
    voterCount: row.voter_count,
    // 总票数 = 各选项票数之和；多选时会大于 voterCount，单选时相等
    totalVotes: isSurvey ? row.answer_count : (voteSumRow?.n ?? 0),
    todayNew: todayRow?.n ?? 0,
    progress,
    latestAt: latestRow?.t ?? null,
    trend,
    hours,
    peakText: peak.value
      ? `${isSurvey ? '提交' : '投票'}高峰集中在${peak.label} 点，占全部的 ${peak.pct}%`
      : '还没有足够的记录，等收到一些再来看'
  }
}

/* ============================================================
 * 14/15 投票记录
 * ============================================================ */

export async function pollVoters(db: D1Database, pollId: string, viewerId: string | null) {
  const row = await getPollRowOrThrow(db, pollId)
  const isOwner = row.creator_id === viewerId

  const { results } = await db
    .prepare(
      `SELECT v.id, v.created_at, v.option_ids, v.profile_info,
              u.id AS user_id, u.nickname AS user_name
       FROM votes v LEFT JOIN users u ON u.id = v.user_id
       WHERE v.poll_id = ?
       ORDER BY v.created_at DESC LIMIT 200`
    )
    .bind(pollId)
    .all<{
      id: string
      created_at: number
      option_ids: string
      profile_info: string | null
      user_id: string | null
      user_name: string | null
    }>()

  const optRes = await db
    .prepare('SELECT id, title FROM options WHERE poll_id = ?')
    .bind(pollId)
    .all<{ id: string; title: string }>()
  const titles = new Map(optRes.results.map((o) => [o.id, o.title]))

  return results.map((v) => ({
    id: v.id,
    createdAt: v.created_at,
    // 匿名投票不返回投票人，哪怕是发起人
    user: row.anonymous || !v.user_id ? undefined : { id: v.user_id, name: v.user_name ?? '' },
    optionTitle: parseIds(v.option_ids)
      .map((id) => titles.get(id) ?? '')
      .filter(Boolean)
      .join(' / '),
    // 发起人要求填的个人信息只有发起人能看到
    profileInfo: isOwner ? (v.profile_info ?? undefined) : undefined
  }))
}

/* ============================================================
 * 84/86 问卷汇总
 *
 * 真正的「把自由回答归成选项」需要语义归类（大模型或聚类算法），
 * 这里先用「内容完全相同」做最小可用的分组：重复出现的回答成为候选选项，
 * 其余进未归类。等接了模型只换这一个函数。
 * ============================================================ */

export async function summaryGroups(db: D1Database, pollId: string) {
  const { results } = await db
    .prepare(
      `SELECT id, content, created_at FROM answers WHERE poll_id = ? ORDER BY created_at DESC`
    )
    .bind(pollId)
    .all<{ id: string; content: string; created_at: number }>()

  const groups = new Map<string, typeof results>()
  for (const a of results) {
    const key = a.content.trim()
    const arr = groups.get(key)
    if (arr) arr.push(a)
    else groups.set(key, [a])
  }

  const repeated = [...groups.entries()].filter(([, list]) => list.length >= 2)
  const candidateKeys = new Set(repeated.map(([key]) => key))

  const candidates = repeated
    .sort((a, b) => b[1].length - a[1].length)
    .map(([content, list], i) => ({
      id: `c_${i + 1}`,
      title: content.slice(0, 12),
      desc: content.length > 12 ? content.slice(0, 30) : '',
      answerCount: list.length,
      sample: content.slice(0, 40)
    }))

  const unclassified = [...groups.entries()]
    .filter(([key]) => !candidateKeys.has(key))
    .flatMap(([, list]) => list)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 50)
    .map((a) => ({ id: a.id, createdAt: a.created_at, content: a.content }))

  return { candidates, unclassified }
}
