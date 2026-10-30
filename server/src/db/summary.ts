/**
 * 汇总（问卷 → 投票）的读写
 *
 * 归并结果落库，不靠前端内存：编辑选项、归入已有、忽略、重新归并
 * 都要跨页面、跨次访问保留。
 *
 * 自动归并只做「原文完全相同」的最简分组，够把流程跑通；
 * 将来接语义聚类，只需要换掉 ensureGrouped 里分组那一段。
 */

import { newId } from '../lib/id'
import { HttpError } from '../lib/response'

const TITLE_MAX = 12
const DESC_MAX = 20
const UNCLASSIFIED_PAGE = 100

/** 未归类列表的游标：`created_at:id`，翻页间隙忽略掉顶部条目也不会漏页 */
function encodeCursor(createdAt: number, id: string): string {
  return `${createdAt}:${id}`
}

function decodeCursor(cursor: string | null | undefined): { at: number; id: string } | null {
  if (!cursor) return null
  const i = cursor.indexOf(':')
  if (i <= 0) return null
  const at = Number(cursor.slice(0, i))
  const id = cursor.slice(i + 1)
  if (!Number.isFinite(at) || !id) return null
  return { at, id }
}

/**
 * 归并前先统一文本：连续空白压成一个空格，去掉句尾标点。
 * 「同意了。」和「同意了」是同一个意思，不该因为一个句号分成两组。
 */
function normalizeText(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[。．.!！?？,，;；、]+$/, '')
    .trim()
}

/**
 * 截断后的标题可能撞车（两段不同原文前 12 个字一样）。
 * 后出现的加「（2）」「（3）」，不要把两个选项做成同名。
 */
function uniqueTitle(base: string, used: Set<string>): string {
  let title = base.slice(0, TITLE_MAX)
  let n = 2
  while (used.has(title)) {
    const suffix = `（${n++}）`
    title = base.slice(0, TITLE_MAX - suffix.length) + suffix
  }
  used.add(title)
  return title
}

/** 手动新建/改名时不允许重名：结果页两行一样的标题，投票人分不清 */
async function assertTitleFree(
  db: D1Database,
  pollId: string,
  title: string,
  exceptId?: string
): Promise<string> {
  const stored = title.slice(0, TITLE_MAX)
  const row = await db
    .prepare(
      `SELECT id FROM summary_options
       WHERE poll_id = ? AND title = ?${exceptId ? ' AND id != ?' : ''}
       LIMIT 1`
    )
    .bind(...(exceptId ? [pollId, stored, exceptId] : [pollId, stored]))
    .first<{ id: string }>()
  if (row) throw new HttpError(400, `已经有「${stored}」这个选项了`)
  return stored
}

export interface SummaryOptionOut {
  id: string
  title: string
  desc: string
  answerCount: number
  sample: string
}

export interface SummaryAnswerOut {
  id: string
  createdAt: number
  content: string
}

export interface SummaryOptionDetail extends SummaryOptionOut {
  answers: SummaryAnswerOut[]
}

interface OptionRow {
  id: string
  title: string
  desc: string
  answer_count: number
  sample: string
}

interface AnswerRow {
  id: string
  created_at: number
  content: string
}

/**
 * 原文 → 稳定的候选 id：同一份问卷里同一段原文反复归并不会重复建选项。
 *
 * id 必须带上 pollId：不同问卷很容易出现相同的短回答（“同意”“可以”），
 * 只哈希原文会让第二份问卷的候选 id 和第一份撞车，INSERT OR IGNORE 直接
 * 把它的候选吞掉，回答就永远显示不出来。
 */
function contentKey(pollId: string, content: string): string {
  let h = 0
  const text = `${pollId}\u0000${content}`
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(h, 31) + text.charCodeAt(i)) >>> 0
  }
  return `c_${h.toString(36)}`
}

/**
 * 只有问卷能汇总，而且只有发起人能看/能改。
 * 回答里有参与者写的内容，不能像投票详情那样公开。
 */
export async function assertSummaryOwner(db: D1Database, pollId: string, userId: string) {
  const row = await db
    .prepare('SELECT id, creator_id, type FROM polls WHERE id = ? AND deleted_at IS NULL')
    .bind(pollId)
    .first<{ id: string; creator_id: string; type: string }>()
  if (!row) throw new HttpError(404, '问卷不存在')
  if (row.type !== 'survey') throw new HttpError(400, '只有问卷可以汇总')
  if (row.creator_id !== userId) throw new HttpError(403, '只有发起人可以整理回答')
  return row
}

/**
 * 把还没处理过的回答自动分一次组。
 *
 * 已经有 assignment 的回答一律不动——用户手动归过类的结果优先，
 * 新回答进来时也只处理新增的那些。
 */
export async function ensureGrouped(db: D1Database, pollId: string): Promise<void> {
  const [{ results: answers }, { results: handled }, { results: existing }] = await Promise.all([
    db
      .prepare('SELECT id, content FROM answers WHERE poll_id = ? ORDER BY created_at DESC')
      .bind(pollId)
      .all<{ id: string; content: string }>(),
    db
      .prepare('SELECT answer_id FROM summary_assignments WHERE poll_id = ?')
      .bind(pollId)
      .all<{ answer_id: string }>(),
    db
      .prepare('SELECT title FROM summary_options WHERE poll_id = ?')
      .bind(pollId)
      .all<{ title: string }>()
  ])

  const done = new Set(handled.map((r) => r.answer_id))
  const pending = answers.filter((a) => !done.has(a.id))
  if (!pending.length) return

  // 先按归一化后的原文分组：空白、句尾标点不同但意思一样的不拆成两组
  const groups = new Map<string, string[]>()
  const blanks: string[] = []
  for (const a of pending) {
    const text = normalizeText(a.content)
    if (!text) {
      blanks.push(a.id)
      continue
    }
    const arr = groups.get(text) ?? []
    arr.push(a.id)
    groups.set(text, arr)
  }

  const now = Date.now()
  const statements: D1PreparedStatement[] = []
  // 已有选项的标题先占住，自动生成的候选不能和它们重名
  const usedTitles = new Set(existing.map((o) => o.title))

  for (const [text, ids] of groups) {
    if (ids.length >= 2) {
      const id = contentKey(pollId, text)
      const title = uniqueTitle(text, usedTitles)
      statements.push(
        db
          .prepare(
            'INSERT OR IGNORE INTO summary_options (id, poll_id, title, desc, sort, created_at) VALUES (?, ?, ?, ?, 0, ?)'
          )
          .bind(id, pollId, title, text.length > TITLE_MAX ? text.slice(0, DESC_MAX) : '', now)
      )
      for (const answerId of ids) {
        statements.push(
          db
            .prepare(
              'INSERT OR REPLACE INTO summary_assignments (answer_id, poll_id, option_id, ignored, updated_at) VALUES (?, ?, ?, 0, ?)'
            )
            .bind(answerId, pollId, id, now)
        )
      }
    } else {
      // 只出现一次的先放未归类，等用户决定
      statements.push(
        db
          .prepare(
            'INSERT OR REPLACE INTO summary_assignments (answer_id, poll_id, option_id, ignored, updated_at) VALUES (?, ?, NULL, 0, ?)'
          )
          .bind(ids[0], pollId, now)
      )
    }
  }

  // 空回答（问卷允许跳过）不参与汇总，也不该出现在未归类里刷屏
  for (const answerId of blanks) {
    statements.push(
      db
        .prepare(
          'INSERT OR REPLACE INTO summary_assignments (answer_id, poll_id, option_id, ignored, updated_at) VALUES (?, ?, NULL, 1, ?)'
        )
        .bind(answerId, pollId, now)
    )
  }

  if (statements.length) await db.batch(statements)
}

export async function listCandidates(db: D1Database, pollId: string): Promise<SummaryOptionOut[]> {
  await ensureGrouped(db, pollId)
  const { results } = await db
    .prepare(
      `SELECT o.id,
              o.title,
              COALESCE(o.desc, '') AS desc,
              COUNT(sa.answer_id) AS answer_count,
              COALESCE((
                SELECT ans.content
                FROM summary_assignments sa2
                JOIN answers ans ON ans.id = sa2.answer_id
                WHERE sa2.option_id = o.id AND sa2.poll_id = o.poll_id AND sa2.ignored = 0
                ORDER BY sa2.updated_at DESC
                LIMIT 1
              ), '') AS sample
       FROM summary_options o
       LEFT JOIN summary_assignments sa
         ON sa.option_id = o.id AND sa.poll_id = o.poll_id AND sa.ignored = 0
       WHERE o.poll_id = ?
       GROUP BY o.id
       ORDER BY answer_count DESC, o.sort ASC, o.created_at ASC`
    )
    .bind(pollId)
    .all<OptionRow>()

  return results.map((r) => ({
    id: r.id,
    title: r.title,
    desc: r.desc,
    answerCount: r.answer_count,
    sample: r.sample
  }))
}

/**
 * 未归类回答分页返回。
 *
 * 以前写死 LIMIT 100，页面把「100」当成总数展示，「全部忽略」也只忽略加载到的
 * 100 条；超过 100 条的回答既看不到也忽略不掉。现在带 cursor/total，
 * 「全部忽略」由服务端按条件一次处理，和前端加载了多少无关。
 */
export async function listUnclassified(
  db: D1Database,
  pollId: string,
  cursor?: string | null
): Promise<{ list: SummaryAnswerOut[]; cursor: string | null; hasMore: boolean; total: number }> {
  await ensureGrouped(db, pollId)

  const totalRow = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM summary_assignments sa
       JOIN answers ans ON ans.id = sa.answer_id
       WHERE sa.poll_id = ? AND sa.option_id IS NULL AND sa.ignored = 0`
    )
    .bind(pollId)
    .first<{ n: number }>()
  const total = totalRow?.n ?? 0

  const after = decodeCursor(cursor)
  const where = after ? 'AND (ans.created_at < ? OR (ans.created_at = ? AND ans.id < ?))' : ''
  const binds: Array<string | number> = after
    ? [pollId, after.at, after.at, after.id, UNCLASSIFIED_PAGE + 1]
    : [pollId, UNCLASSIFIED_PAGE + 1]

  const { results } = await db
    .prepare(
      `SELECT ans.id, ans.created_at, ans.content
       FROM summary_assignments sa
       JOIN answers ans ON ans.id = sa.answer_id
       WHERE sa.poll_id = ? AND sa.option_id IS NULL AND sa.ignored = 0 ${where}
       ORDER BY ans.created_at DESC, ans.id DESC
       LIMIT ?`
    )
    .bind(...binds)
    .all<AnswerRow>()

  const hasMore = results.length > UNCLASSIFIED_PAGE
  const page = hasMore ? results.slice(0, UNCLASSIFIED_PAGE) : results
  const list = page.map((r) => ({ id: r.id, createdAt: r.created_at, content: r.content }))
  const last = page[page.length - 1]
  return {
    list,
    cursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    hasMore,
    total
  }
}

export async function getOption(
  db: D1Database,
  pollId: string,
  optionId: string
): Promise<SummaryOptionDetail> {
  const opt = await db
    .prepare(`SELECT id, title, COALESCE(desc, '') AS desc FROM summary_options WHERE id = ? AND poll_id = ?`)
    .bind(optionId, pollId)
    .first<{ id: string; title: string; desc: string }>()
  if (!opt) throw new HttpError(404, '选项不存在')

  const { results } = await db
    .prepare(
      `SELECT ans.id, ans.created_at, ans.content
       FROM summary_assignments sa
       JOIN answers ans ON ans.id = sa.answer_id
       WHERE sa.option_id = ? AND sa.poll_id = ? AND sa.ignored = 0
       ORDER BY ans.created_at DESC`
    )
    .bind(optionId, pollId)
    .all<AnswerRow>()

  const answers = results.map((r) => ({ id: r.id, createdAt: r.created_at, content: r.content }))
  return {
    id: opt.id,
    title: opt.title,
    desc: opt.desc,
    answerCount: answers.length,
    sample: answers[0]?.content ?? '',
    answers
  }
}

export async function updateOption(
  db: D1Database,
  pollId: string,
  optionId: string,
  patch: { title?: unknown; desc?: unknown }
): Promise<void> {
  const title = String(patch.title ?? '').trim()
  if (!title) throw new HttpError(400, '选项标题不能为空')
  const desc = String(patch.desc ?? '').trim()
  const stored = await assertTitleFree(db, pollId, title, optionId)

  const res = await db
    .prepare('UPDATE summary_options SET title = ?, desc = ? WHERE id = ? AND poll_id = ?')
    .bind(stored, desc.slice(0, DESC_MAX), optionId, pollId)
    .run()
  if (!res.meta.changes) throw new HttpError(404, '选项不存在')
}

export async function deleteOption(db: D1Database, pollId: string, optionId: string): Promise<void> {
  const res = await db
    .prepare('DELETE FROM summary_options WHERE id = ? AND poll_id = ?')
    .bind(optionId, pollId)
    .run()
  if (!res.meta.changes) throw new HttpError(404, '选项不存在')

  // 归在它下面的回答回到未归类，原文不丢
  await db
    .prepare('UPDATE summary_assignments SET option_id = NULL, updated_at = ? WHERE poll_id = ? AND option_id = ?')
    .bind(Date.now(), pollId, optionId)
    .run()
}

/** 只保留属于这份问卷的回答 id，防止跨问卷塞数据 */
async function ownAnswerIds(db: D1Database, pollId: string, rawIds: unknown): Promise<string[]> {
  const ids = Array.isArray(rawIds)
    ? [...new Set(rawIds.map((x) => String(x)).filter(Boolean))]
    : []
  if (!ids.length) return []

  // D1 单条 SQL 最多 100 个绑定参数，pollId 占一个，所以每次最多查 90 个。
  // 「忽略全部未归类」一次会传 100 条，不分批会直接报参数过多。
  const owned: string[] = []
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90)
    const { results } = await db
      .prepare(
        `SELECT id FROM answers WHERE poll_id = ? AND id IN (${chunk.map(() => '?').join(',')})`
      )
      .bind(pollId, ...chunk)
      .all<{ id: string }>()
    owned.push(...results.map((r) => r.id))
  }
  return owned
}

async function assertOption(db: D1Database, pollId: string, optionId: string) {
  const opt = await db
    .prepare('SELECT id FROM summary_options WHERE id = ? AND poll_id = ?')
    .bind(optionId, pollId)
    .first<{ id: string }>()
  if (!opt) throw new HttpError(404, '选项不存在')
}

export async function createOption(
  db: D1Database,
  pollId: string,
  input: { title?: unknown; desc?: unknown; answerIds?: unknown }
): Promise<{ id: string }> {
  const title = String(input.title ?? '').trim()
  if (!title) throw new HttpError(400, '选项标题不能为空')
  const desc = String(input.desc ?? '').trim()
  const stored = await assertTitleFree(db, pollId, title)
  const id = newId('c')
  const now = Date.now()

  const max = await db
    .prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM summary_options WHERE poll_id = ?')
    .bind(pollId)
    .first<{ s: number }>()

  await db
    .prepare('INSERT INTO summary_options (id, poll_id, title, desc, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, pollId, stored, desc.slice(0, DESC_MAX), (max?.s ?? 0) + 1, now)
    .run()

  await assignAnswers(db, pollId, id, input.answerIds)
  return { id }
}

export async function assignAnswers(
  db: D1Database,
  pollId: string,
  optionId: string,
  rawIds: unknown
): Promise<void> {
  await assertOption(db, pollId, optionId)
  const ids = await ownAnswerIds(db, pollId, rawIds)
  if (!ids.length) return

  const now = Date.now()
  await db.batch(
    ids.map((answerId) =>
      db
        .prepare(
          'INSERT OR REPLACE INTO summary_assignments (answer_id, poll_id, option_id, ignored, updated_at) VALUES (?, ?, ?, 0, ?)'
        )
        .bind(answerId, pollId, optionId, now)
    )
  )
}

/** 移出：回答回到未归类，可以再归到别的选项 */
export async function unassignAnswer(
  db: D1Database,
  pollId: string,
  optionId: string,
  answerId: string
): Promise<void> {
  const res = await db
    .prepare(
      'UPDATE summary_assignments SET option_id = NULL, updated_at = ? WHERE poll_id = ? AND option_id = ? AND answer_id = ?'
    )
    .bind(Date.now(), pollId, optionId, answerId)
    .run()
  if (!res.meta.changes) throw new HttpError(404, '这条回答不在该选项下')
}

/**
 * 忽略：原文留在问卷里，只是不参与这次汇总。
 * all=true 由服务端按「所有未归类」处理，不受分页影响。
 */
export async function ignoreAnswers(
  db: D1Database,
  pollId: string,
  rawIds: unknown,
  all = false
): Promise<number> {
  const now = Date.now()
  if (all) {
    await ensureGrouped(db, pollId)
    const res = await db
      .prepare(
        `UPDATE summary_assignments
         SET ignored = 1, updated_at = ?
         WHERE poll_id = ? AND option_id IS NULL AND ignored = 0`
      )
      .bind(now, pollId)
      .run()
    return res.meta.changes ?? 0
  }

  const ids = await ownAnswerIds(db, pollId, rawIds)
  if (!ids.length) return 0

  await db.batch(
    ids.map((answerId) =>
      db
        .prepare(
          'INSERT OR REPLACE INTO summary_assignments (answer_id, poll_id, option_id, ignored, updated_at) VALUES (?, ?, NULL, 1, ?)'
        )
        .bind(answerId, pollId, now)
    )
  )
  return ids.length
}

/** 重新归并：清掉这次汇总的所有整理结果，按原文重新分一次组 */
export async function resetSummary(db: D1Database, pollId: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM summary_assignments WHERE poll_id = ?').bind(pollId),
    db.prepare('DELETE FROM summary_options WHERE poll_id = ?').bind(pollId)
  ])
  await ensureGrouped(db, pollId)
}
