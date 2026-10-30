/**
 * 投票 / 问卷的读写
 *
 * 所有 SQL 都在这个文件里，路由层只调函数。将来要换数据库
 * （比如迁到 MySQL 或 Supabase）只改 db/ 这一层。
 */

import type {
  AnswerRow,
  Env,
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
import { assertCanJoin, isInviteOnly, newInviteCode } from './invites'
import { notifyPollUpdated } from './notifications'
import { HttpError } from '../lib/response'

const PAGE_SIZE = 20
/** 投票记录一页多少条 */
const VOTERS_PAGE_SIZE = 50
/** 删除后的「撤销」窗口：界面提示 5 秒，服务端放到 10 秒，给网络留余量 */
const RESTORE_WINDOW_MS = 10_000
const DAY_MS = 86_400_000
/** 东八区偏移：统计「今天新增」「按小时分布」都要按中国时区切 */
const TZ_OFFSET = 8 * 3_600_000

/* ============================================================
 * 行 → 前端对象
 * ============================================================ */

/**
 * 结果可见性：发起人永远能看；其他人按 result_visibility 判断。
 * 放在服务端算，是因为接口直接返回票数，只在前端藏等于没藏。
 */
function canSeeResult(
  row: PollRowJoined,
  mine: { optionIds?: string[]; answered?: boolean } | undefined,
  isCreator: boolean
): boolean {
  if (isCreator) return true
  if (row.result_visibility === 'always') return true
  if (row.result_visibility === 'hidden') return false
  if (row.result_visibility === 'after_end') return row.status === 1 || row.end_at <= Date.now()
  // after_vote：投过/答过才给看
  return !!(mine?.optionIds?.length || mine?.answered)
}

/** FNV-1a，用来做「同一用户每次刷新顺序一致」的打乱 */
function hashSeed(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * 选项随机：按「投票 + 查看者」做稳定排序。
 * 不能真随机 —— 每次渲染顺序都变的话，用户点下去的和看到的对不上。
 * 发起人自己看原顺序，编辑选项时不会错位。
 */
function shuffleOptions(options: PollOptionOut[], seed: string): PollOptionOut[] {
  return [...options].sort((a, b) => hashSeed(`${seed}:${a.id}`) - hashSeed(`${seed}:${b.id}`))
}

function toPoll(
  row: PollRowJoined,
  options: OptionRow[],
  mine?: { optionIds?: string[]; answered?: boolean },
  viewerId?: string | null
): PollOut {
  const type = row.type as PollType
  const isSurvey = type === 'survey'
  const isCreator = !!viewerId && viewerId === row.creator_id
  const resultVisible = isSurvey || canSeeResult(row, mine, isCreator)

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
      // 老数据的 group / private 在接口层统一成 invite，前端只需要认两种
      joinMethod:
        row.join_method === 'group' || row.join_method === 'private'
          ? 'invite'
          : row.join_method,
      profileField: row.profile_field,
      endAt: row.end_at
    },
    options: options.map<PollOptionOut>((o) => ({
      id: o.id,
      title: o.title,
      desc: o.desc ?? undefined,
      // 结果不可见时票数直接给 0，避免从接口里把票数读出来
      votes: resultVisible ? o.votes_count : 0
    })),
    // 关闭「查看投票人数」后，非发起人拿到的就是 0；前端据此不显示人数
    voterCount: !isSurvey && row.hide_voter_count && !isCreator ? 0 : row.voter_count,
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
  // 只有真的改过内容才写 updated_at；发布后从未编辑过时为 null，前端不显示「已编辑」
  if (row.updated_at) poll.updatedAt = row.updated_at

  // 选项随机只对查看者生效，发起人看的是创建时的顺序
  if (!isSurvey && row.shuffle_options && !isCreator) {
    poll.options = shuffleOptions(poll.options, `${row.id}:${viewerId ?? 'anon'}`)
  }

  // 邀请码只给发起人：它不随分享链接/海报传播，由发起人单独告知参与者
  // （老的 private / group 也算邀请制）
  if (isCreator && isInviteOnly(row) && row.invite_code) {
    poll.inviteCode = row.invite_code
  }

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
    toPoll(
      row,
      optionsByPoll.get(row.id) ?? [],
      {
        optionIds: myVotes.get(row.id),
        answered: answered.has(row.id)
      },
      viewerId
    )
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
    // 需要邀请码的投票、以及发起人关掉分享的投票都不出现在发现页
    where: `p.deleted_at IS NULL AND p.allow_share = 1
      AND p.join_method NOT IN ('invite', 'private', 'group')${s.sql}`,
    params: s.params,
    viewerId,
    cursor
  })
}

/**
 * 02 首页 · 待我投票
 *
 * 只看「别人分享给我、我还没参与」的：邀请记录由 share/join 落地页写入，
 * 比「进行中 + 我没投」精确得多 —— 后者会把全站没人邀请过我的投票都算进来。
 *
 * 问卷也算「待我投票」：受邀后还没提交过回答，就应该出现在首页。
 * 列表按截止时间由近到远排，用 end_at + id 做游标分页：待办随时可能有新邀请进来，
 * offset 会把后面的条目往后挤，游标则从「上次看到的位置」继续。
 */
export async function listPending(
  db: D1Database,
  userId: string,
  limit = 5,
  cursor?: string | null
) {
  const now = Date.now()

  // 总数单独查：首页角标要显示真实待办数，不能把「第一页的条数」当成总数
  const totalRow = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM invites i
       JOIN polls p ON p.id = i.poll_id
       WHERE i.invitee_id = ?
         AND p.deleted_at IS NULL
         AND p.status = 0 AND p.end_at > ?
         AND p.creator_id != ?
         AND (
           (p.type != 'survey' AND NOT EXISTS (
             SELECT 1 FROM votes v WHERE v.poll_id = p.id AND v.user_id = ?
           ))
           OR (p.type = 'survey' AND NOT EXISTS (
             SELECT 1 FROM answers a WHERE a.poll_id = p.id AND a.user_id = ?
           ))
         )`
    )
    .bind(userId, now, userId, userId, userId)
    .first<{ n: number }>()
  const total = totalRow?.n ?? 0

  // 游标是上一页最后一条的 `end_at:id`，升序排：下一页取 end_at 更大、或同截止但 id 更大的
  let after: { at: number; id: string } | null = null
  if (cursor) {
    const i = cursor.indexOf(':')
    if (i > 0) {
      const at = Number(cursor.slice(0, i))
      if (Number.isFinite(at)) after = { at, id: cursor.slice(i + 1) }
    }
  }
  const where = after ? 'AND (p.end_at > ? OR (p.end_at = ? AND p.id > ?))' : ''
  const binds: Array<string | number> = after
    ? [userId, now, userId, userId, userId, after.at, after.at, after.id, limit + 1]
    : [userId, now, userId, userId, userId, limit + 1]

  const { results } = await db
    .prepare(
      `SELECT p.id, p.title, p.type, p.voter_count, p.answer_count,
              p.max_choice, p.anonymous,
              p.end_at, p.hide_voter_count,
              COALESCE(inv.nickname, u.nickname) AS inviter_name
       FROM invites i
       JOIN polls p ON p.id = i.poll_id
       LEFT JOIN users u ON u.id = p.creator_id
       LEFT JOIN users inv ON inv.id = i.inviter_id
       WHERE i.invitee_id = ?
         AND p.deleted_at IS NULL
         AND p.status = 0 AND p.end_at > ?
         AND p.creator_id != ?
         AND (
           (p.type != 'survey' AND NOT EXISTS (
             SELECT 1 FROM votes v WHERE v.poll_id = p.id AND v.user_id = ?
           ))
           OR (p.type = 'survey' AND NOT EXISTS (
             SELECT 1 FROM answers a WHERE a.poll_id = p.id AND a.user_id = ?
           ))
         )
         ${where}
       ORDER BY p.end_at ASC, p.id ASC
       LIMIT ?`
    )
    .bind(...binds)
    .all<{
      id: string
      title: string
      type: string
      voter_count: number
      answer_count: number
      max_choice: number
      anonymous: number
      end_at: number
      hide_voter_count: number
      inviter_name: string | null
    }>()

  const hasMore = results.length > limit
  const page = hasMore ? results.slice(0, limit) : results
  const last = page[page.length - 1]
  return {
    list: page.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type as 'single' | 'multiple' | 'survey',
      inviterName: r.inviter_name ?? '朋友',
      voterCount: r.hide_voter_count ? 0 : r.voter_count,
      answerCount: r.answer_count,
      anonymous: !!r.anonymous,
      maxChoice: r.max_choice,
      endAt: r.end_at
    })),
    cursor: hasMore && last ? `${last.end_at}:${last.id}` : null,
    hasMore,
    total
  }
}

function escapeLike(text: string): string {
  // ESCAPE 是反斜杠，关键词里的 \ 也要转义，否则 "a\b" 会拼出非法 pattern
  return text.replace(/[%_\\]/g, (m) => `\\${m}`)
}

export async function searchPolls(
  db: D1Database,
  viewerId: string | null,
  keyword: string,
  sort: 'latest' | 'hot' = 'latest'
): Promise<PollOut[]> {
  // D1 的 LIKE / GLOB pattern 最多 50 字节。中文一个字 3 字节，
  // 关键词太长会直接报错；这里从尾部逐步缩短，保证转义后也不超限。
  let kw = keyword.trim()
  let pattern = escapeLike(kw)
  while (kw && new TextEncoder().encode(`%${pattern}%`).length > 50) {
    kw = [...kw].slice(0, -1).join('')
    pattern = escapeLike(kw)
  }
  if (!kw) return []
  const like = `%${pattern}%`
  // 最热按参与人数排；投票和问卷的参与数分在两列，加起来才能放到一起比
  const order =
    sort === 'hot'
      ? '(p.voter_count + p.answer_count) DESC, p.created_at DESC'
      : 'p.created_at DESC'
  const { results } = await db
    .prepare(
      `${SELECT_JOINED}
       WHERE p.deleted_at IS NULL
         AND (p.title LIKE ? ESCAPE '\\' OR p.desc LIKE ? ESCAPE '\\')
         -- 关掉分享的投票不对外暴露，发起人自己仍能搜到
         AND (p.allow_share = 1 OR p.creator_id = ?)
         -- 邀请码模式的投票不进搜索结果，除非我是发起人或者已经被邀请过
         AND (
           p.join_method NOT IN ('invite', 'private', 'group')
           OR p.creator_id = ?
           OR EXISTS (SELECT 1 FROM invites i WHERE i.poll_id = p.id AND i.invitee_id = ?)
         )
       ORDER BY ${order} LIMIT 30`
    )
    .bind(like, like, viewerId ?? '', viewerId ?? '', viewerId ?? '')
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
  // 已删除的投票对其他人返回 410，前端可以显示「已被发起人删除」而不是通用错误页。
  // 发起人自己仍能读到（软删除后的恢复流程要用）。
  if (row.deleted_at && row.creator_id !== viewerId) {
    throw new HttpError(410, '发起人已删除该投票')
  }

  const [poll] = await hydrate(db, [row], viewerId)

  // 「最近投票」只有详情页要，列表页不需要，所以只在这里补一次
  const table = row.type === 'survey' ? 'answers' : 'votes'
  const latest = await db
    .prepare(`SELECT MAX(created_at) AS t FROM ${table} WHERE poll_id = ?`)
    .bind(id)
    .first<{ t: number | null }>()

  return { ...poll, latestAt: latest?.t ?? undefined }
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
const JOIN_METHODS = ['link', 'invite']
const MAX_OPTIONS = 20

/** 参与方式只保留两档：链接可投 / 需要邀请码。
 *  老数据里的 group、private 都算「需要邀请码」。 */
function normalizeJoinMethod(raw: string | undefined): 'link' | 'invite' {
  if (raw === 'invite' || raw === 'private' || raw === 'group') return 'invite'
  return 'link'
}

function normalizeType(raw: string | undefined): PollType {
  return raw === 'survey' || raw === 'multiple' ? raw : 'single'
}

function normalizeTitle(raw: string | undefined): string {
  // API 直接传数字 / null 时不能 .trim() 抛 500，统一转成字符串再校验
  const title = (raw == null ? '' : String(raw)).trim()
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
    joinMethod: normalizeJoinMethod(r.joinMethod),
    profileField: r.profileField ? String(r.profileField).trim().slice(0, 20) : null,
    endAt: Number.isFinite(endAt) && endAt > 0 ? Math.trunc(endAt) : fallbackEndAt
  }
}

/** 把数据库里现有的规则转成 RulesInput，供部分更新时合并 */
function rulesInputFromRow(row: PollRowJoined): RulesInput {
  return {
    anonymous: !!row.anonymous,
    allowEdit: !!row.allow_edit,
    allowShare: !!row.allow_share,
    allowComment: !!row.allow_comment,
    allowRepeat: !!row.allow_repeat,
    limitIp: !!row.limit_ip,
    maxChoice: row.max_choice,
    resultVisibility: row.result_visibility,
    shuffleOptions: !!row.shuffle_options,
    hideVoterCount: !!row.hide_voter_count,
    joinMethod: normalizeJoinMethod(row.join_method),
    profileField: row.profile_field,
    endAt: row.end_at
  }
}

function cleanOptions(raw: PollBody['options']): Array<{ title: string; desc: string | null }> {
  const list = (Array.isArray(raw) ? raw : [])
    .map((o) => ({ title: String(o?.title ?? '').trim(), desc: String(o?.desc ?? '').trim() }))
    .filter((o) => o.title)
    .map((o) => ({ title: o.title.slice(0, 40), desc: o.desc.slice(0, 80) || null }))

  if (list.length > MAX_OPTIONS) throw new HttpError(400, `选项最多 ${MAX_OPTIONS} 个`)
  // 同名选项会让结果页出现两行一模一样的标题，投票人也分不清投的是哪个
  const seen = new Set<string>()
  for (const o of list) {
    if (seen.has(o.title)) throw new HttpError(400, `选项「${o.title}」重复了`)
    seen.add(o.title)
  }
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

  // 汇总投票会带 sourceSurveyId。只认自己发起的、未删除的问卷，
  // 否则任何人都能把新投票挂到别人的问卷上。
  const sourceSurveyId =
    typeof body.sourceSurveyId === 'string' && body.sourceSurveyId.trim()
      ? body.sourceSurveyId.trim()
      : null
  if (sourceSurveyId) {
    const src = await db
      .prepare('SELECT id, creator_id, type FROM polls WHERE id = ? AND deleted_at IS NULL')
      .bind(sourceSurveyId)
      .first<{ id: string; creator_id: string; type: string }>()
    if (!src || src.type !== 'survey' || src.creator_id !== creatorId) {
      throw new HttpError(400, '来源问卷不存在')
    }
  }

  const now = Date.now()
  const rules = normalizeRules(body.rules, type, now + 3 * DAY_MS)
  // 前端会拦，但 API 直接传过去也不该创建出一发布就结束的投票
  if (rules.endAt <= now) throw new HttpError(400, '截止时间必须晚于现在')
  const pollId = newId('p')

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO polls (
           id, creator_id, type, title, desc, status, created_at, end_at,
           anonymous, allow_edit, allow_share, allow_comment, allow_repeat, limit_ip,
           max_choice, result_visibility, shuffle_options, hide_voter_count,
           join_method, invite_code, profile_field, source_survey_id
         ) VALUES (?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        pollId,
        creatorId,
        type,
        title,
        String(body.desc ?? '').trim().slice(0, 500) || null,
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
        rules.joinMethod === 'invite' ? newInviteCode() : null,
        rules.profileField,
        sourceSurveyId
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
  body: PollBody,
  env?: Env
): Promise<PollOut> {
  const row = await findPollRow(db, pollId)
  if (!row) throw new HttpError(404, '投票不存在')
  if (row.creator_id !== userId) throw new HttpError(403, '只有发起人可以编辑')
  if (row.deleted_at) throw new HttpError(400, '投票已删除，请先恢复')

  const type = row.type as PollType
  // PUT 允许只传要改的字段：没传 title / desc / rules 时保留原值，
  // 不能拿默认规则覆盖已有配置（比如把匿名、邀请制悄悄改回默认）。
  const title = body.title === undefined ? row.title : normalizeTitle(body.title)
  const nextDesc =
    body.desc === undefined
      ? row.desc
      : String(body.desc ?? '').trim().slice(0, 500) || null
  const now = Date.now()
  const ended = row.status === 1 || row.end_at <= now
  const hasResponses = row.voter_count > 0 || row.answer_count > 0
  /** 当前规则按写入时的归一化结果，和入参规则用同一套口径比较 */
  const currentRules = normalizeRules(rulesInputFromRow(row), type, row.end_at)
  // 传了 rules 就只覆盖传进来的字段，没传的沿用原值；
  // 完全没传 rules 时直接用归一化后的当前值，避免和数据库原始 0/1 比较出假改动。
  const rules = body.rules
    ? normalizeRules({ ...rulesInputFromRow(row), ...body.rules }, type, row.end_at)
    : currentRules

  // 已结束：只允许改主题和说明。选项和规则全部锁定 ——
  // 结果已经公示，再改规则或选项会让已入库的数据对不上。
  if (ended) {
    const nowRules = rules as Record<string, unknown>
    const dbRules = currentRules as Record<string, unknown>
    const rulesTouched = Object.keys(currentRules).some((k) => nowRules[k] !== dbRules[k])
    if (rulesTouched) throw new HttpError(400, '已结束，只能修改主题和说明')
  }

  // 进行中且已有参与记录：只锁会影响「已入库数据含义」的规则。
  if (hasResponses && !ended) {
    // 截止时间只能延后：参与者是按原来的截止时间决定要不要现在投的
    if (rules.endAt < row.end_at) {
      throw new HttpError(400, '已有参与记录，截止时间只能延后')
    }
    // 匿名改公开会翻出投票人身份，公开改匿名又会让已公开的记录失去解释，两个方向都锁
    if (rules.anonymous !== row.anonymous) {
      throw new HttpError(400, '已有参与记录，匿名设置不能再改')
    }
    // 多选上限决定「最多可选几项」，中途收紧会让已有选择变得不合规
    if (type === 'multiple' && rules.maxChoice !== row.max_choice) {
      throw new HttpError(400, '已有投票，选择上限不能再改')
    }
    // 链接 / 邀请码决定谁能进来，已有参与后切换会打乱准入关系
    if (rules.joinMethod !== normalizeJoinMethod(row.join_method)) {
      throw new HttpError(400, '已有参与记录，参与方式不能再改')
    }
    // 问卷能不能重复提交会改变「一个人算几条」的统计口径
    if (type === 'survey' && rules.allowRepeat !== row.allow_repeat) {
      throw new HttpError(400, '已有回答，重复提交设置不能再改')
    }
  }

  // 进行中的投票不能被改成一个已经过去的时间点，否则保存完就直接结束
  if (row.end_at > now && rules.endAt <= now) {
    throw new HttpError(400, '截止时间必须晚于现在')
  }
  // 「提前结束」是不可逆的：状态已经是结束，改截止时间也不能把它重新打开，
  // 否则前端按 endAt 显示「进行中」，后端却继续按 status=1 拒绝参与。
  if (row.status === 1 && rules.endAt > now) {
    throw new HttpError(400, '已结束，不能再延长截止时间')
  }
  /** 选项有没有增删改；问卷没有选项，保持 false */
  let optionsChanged = false

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE polls SET
           title = ?, desc = ?, end_at = ?,
           anonymous = ?, allow_edit = ?, allow_share = ?, allow_comment = ?,
           allow_repeat = ?, limit_ip = ?, max_choice = ?, result_visibility = ?,
           shuffle_options = ?, hide_voter_count = ?, join_method = ?,
           invite_code = ?, profile_field = ?
         WHERE id = ?`
      )
      .bind(
        title,
        nextDesc,
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
        rules.joinMethod === 'invite' ? row.invite_code ?? newInviteCode() : null,
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

    // 只比标题和描述：排序变化、id 变化不算「内容有更新」
    const beforeOptions = existing.results
      .map((o) => `${o.title}\u0000${o.desc ?? ''}`)
      .sort()
      .join('\u0001')
    const afterOptions = next
      .map((o) => `${o.title}\u0000${o.desc ?? ''}`)
      .sort()
      .join('\u0001')
    optionsChanged = beforeOptions !== afterOptions

    // 已结束：选项一律不能再动（排序除外，排序不影响内容）
    if (ended && optionsChanged) {
      throw new HttpError(400, '已结束，选项不能再修改')
    }

    const incoming = (body.options ?? []).filter((o) => String(o?.title ?? '').trim())
    const keptIds = new Set(incoming.map((o) => o.id).filter((id): id is string => !!id && byId.has(id)))

    // 已经有票的选项不能删 —— 删了那些票就凭空消失，别人看到的百分比会变
    const votedDropped = existing.results.filter((o) => !keptIds.has(o.id) && o.votes_count > 0)
    if (votedDropped.length) {
      throw new HttpError(400, `「${votedDropped[0].title}」已有票数，不能删除`)
    }

    // 已有票的选项连文字也不能改：改标题等于偷换大家投过的东西
    const cleanedById = new Map<string, { title: string; desc: string | null }>()
    incoming.forEach((item, i) => {
      if (item.id && byId.has(item.id) && next[i]) cleanedById.set(item.id, next[i])
    })
    for (const o of existing.results) {
      if (o.votes_count <= 0) continue
      const clean = cleanedById.get(o.id)
      if (!clean) continue // 上面已按「不能删除」拦过
      if (clean.title !== o.title || (clean.desc ?? null) !== (o.desc ?? null)) {
        throw new HttpError(400, `「${o.title}」已有票数，不能修改`)
      }
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

  // 只把「真的改了内容」的通知给参与过的人；只是点保存没改动就不打扰
  const changed =
    title !== row.title ||
    nextDesc !== row.desc ||
    rules.endAt !== row.end_at ||
    rules.anonymous !== row.anonymous ||
    rules.allowEdit !== row.allow_edit ||
    rules.allowShare !== row.allow_share ||
    rules.allowComment !== row.allow_comment ||
    rules.allowRepeat !== row.allow_repeat ||
    rules.limitIp !== row.limit_ip ||
    rules.maxChoice !== row.max_choice ||
    rules.resultVisibility !== row.result_visibility ||
    rules.shuffleOptions !== row.shuffle_options ||
    rules.hideVoterCount !== row.hide_voter_count ||
    rules.joinMethod !== normalizeJoinMethod(row.join_method) ||
    rules.profileField !== row.profile_field ||
    optionsChanged

  // 真的改了内容才写「已编辑」时间，和通知共用同一个判断：
  // 打开编辑页点一下保存、什么都没改，不应该留下编辑痕迹。
  if (changed) {
    stmts.push(db.prepare('UPDATE polls SET updated_at = ? WHERE id = ?').bind(now, pollId))
  }

  await db.batch(stmts)

  if (changed && env) {
    // 修改已经保存，通知失败只记日志，不能让用户以为保存失败
    await notifyPollUpdated(db, pollId, type, title, row.creator_id, env).catch((err) =>
      console.error('[notify] poll updated failed', err)
    )
  }

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
  if (!row.deleted_at) throw new HttpError(400, '这个投票没有被删除')
  // 界面上「撤销」只给 5 秒，服务端留 10 秒余量，避免请求在路上超时
  if (Date.now() - row.deleted_at > RESTORE_WINDOW_MS) {
    throw new HttpError(410, '撤销时间已过，投票已删除')
  }
  await db.prepare('UPDATE polls SET deleted_at = NULL WHERE id = ?').bind(pollId).run()
}

/**
 * 提前结束：status 置 1 的同时把 end_at 收到现在，列表排序和「已过 X%」都对得上。
 *
 * 返回「这次是否真的从进行中变成已结束」。重复点结束 / 已经自然到期的投票
 * 不会再次触发结果通知，避免同一批人收到两条一样的消息。
 */
export async function endPoll(db: D1Database, pollId: string, userId: string): Promise<boolean> {
  const row = await findPollRow(db, pollId)
  if (!row || row.deleted_at) throw new HttpError(404, '投票不存在')
  if (row.creator_id !== userId) throw new HttpError(403, '只有发起人可以结束')
  const now = Date.now()
  const res = await db
    .prepare('UPDATE polls SET status = 1, end_at = ? WHERE id = ? AND status = 0')
    .bind(Math.min(now, row.end_at), pollId)
    .run()
  return res.meta.changes > 0
}

export function assertPollOpen(row: PollRow): void {
  if (row.deleted_at) throw new HttpError(404, '投票不存在')
  if (row.status === 1 || row.end_at <= Date.now()) throw new HttpError(400, '投票已结束')
}

export async function getPollRowOrThrow(db: D1Database, pollId: string): Promise<PollRowJoined> {
  const row = await findPollRow(db, pollId)
  // 软删除后，除发起人自己的「恢复 / 详情」外一律按不存在处理。
  // 需要读到已删除行的场景（updatePoll / softDelete / restore / getPoll）
  // 直接走 findPollRow，不经过这里。
  if (!row || row.deleted_at) throw new HttpError(404, '投票不存在')
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
         -- 投票看 voter_count，问卷看 answer_count；两者不会同时有值，直接相加
         COALESCE(SUM(voter_count), 0) + COALESCE(SUM(answer_count), 0) AS voters
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

export async function pollVoters(
  db: D1Database,
  pollId: string,
  viewerId: string | null,
  cursor?: string | null
) {
  const row = await getPollRowOrThrow(db, pollId)
  const isOwner = row.creator_id === viewerId

  // 邀请制投票的参与记录只对发起人和已受邀的人开放；
  // 详情页可以公开预览标题，但投票人名单不能靠知道 poll id 就读到。
  if (isInviteOnly(row) && !isOwner) {
    if (!viewerId) throw new HttpError(403, '需要邀请码才能参与')
    await assertCanJoin(db, row, viewerId)
  }

  // 投票记录里带着「投了哪个选项」，等于把结果公开了。
  // 这里必须按和详情页同一套规则判断，不能只靠前端藏入口。
  let viewerVoted = isOwner
  if (!viewerVoted && viewerId) {
    const mine = await db
      .prepare('SELECT 1 AS x FROM votes WHERE poll_id = ? AND user_id = ?')
      .bind(pollId, viewerId)
      .first()
    viewerVoted = !!mine
  }
  const resultVisible =
    isOwner ||
    row.result_visibility === 'always' ||
    (row.result_visibility === 'after_end' &&
      (row.status === 1 || row.end_at <= Date.now())) ||
    (row.result_visibility === 'after_vote' && viewerVoted)
  if (!resultVisible) throw new HttpError(403, '发起人未公开投票记录')

  // cursor 是上一页最后一条的 created_at，多取一条用来判断还有没有下一页
  const before = cursor ? Number(cursor) : null
  const where = before ? 'AND v.created_at < ?' : ''
  const binds: Array<string | number> = before ? [pollId, before, VOTERS_PAGE_SIZE + 1] : [pollId, VOTERS_PAGE_SIZE + 1]

  const { results } = await db
    .prepare(
      `SELECT v.id, v.created_at, v.option_ids, v.profile_info,
              u.id AS user_id, u.nickname AS user_name
       FROM votes v LEFT JOIN users u ON u.id = v.user_id
       WHERE v.poll_id = ? ${where}
       ORDER BY v.created_at DESC
       LIMIT ?`
    )
    .bind(...binds)
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

  const hasMore = results.length > VOTERS_PAGE_SIZE
  const page = hasMore ? results.slice(0, VOTERS_PAGE_SIZE) : results

  const list = page.map((v) => ({
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

  return {
    list,
    cursor: hasMore ? String(page[page.length - 1].created_at) : null,
    hasMore,
    // 隐藏人数时非发起人拿不到真实总数，和详情页保持一致
    total: isOwner || !row.hide_voter_count ? row.voter_count : 0
  }
}

