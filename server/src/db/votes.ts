import type { Env, PollRowJoined } from '../types'
import { newId } from '../lib/id'
import { HttpError } from '../lib/response'
import { assertCanJoin } from './invites'
import { notifyJoined } from './notifications'
import { assertPollOpen, parseIds } from './polls'

/**
 * 投票
 *
 * 「每人只能投一次」靠 ux_votes_poll_user 唯一索引兜底，不是靠先查后写 ——
 * 两个请求同时到达时，先查后写会双写成功，唯一索引不会。
 */

export async function castVote(
  db: D1Database,
  poll: PollRowJoined,
  userId: string,
  rawOptionIds: string[],
  profileInfo: string | undefined,
  ip: string | null,
  env?: Env
): Promise<void> {
  assertPollOpen(poll)
  if (poll.type === 'survey') throw new HttpError(400, '问卷不能投票')
  // 邀请码模式的投票，没被邀请过的人不能投
  await assertCanJoin(db, poll, userId)

  const optRes = await db
    .prepare('SELECT id FROM options WHERE poll_id = ?')
    .bind(poll.id)
    .all<{ id: string }>()
  const validIds = new Set(optRes.results.map((o) => o.id))

  // 去重 + 过滤掉不属于这条投票的 id，防止前端传别人的选项 id
  const optionIds = [...new Set(rawOptionIds)].filter((id) => validIds.has(id))
  if (!optionIds.length) throw new HttpError(400, '请选择选项')
  if (poll.type === 'single' && optionIds.length !== 1) {
    throw new HttpError(400, '单选题只能选 1 项')
  }
  if (poll.type === 'multiple' && optionIds.length > poll.max_choice) {
    throw new HttpError(400, `最多选 ${poll.max_choice} 项`)
  }

  const existing = await db
    .prepare('SELECT id, option_ids, profile_info FROM votes WHERE poll_id = ? AND user_id = ?')
    .bind(poll.id, userId)
    .first<{ id: string; option_ids: string; profile_info: string | null }>()

  if (existing && !poll.allow_edit) throw new HttpError(409, '你已经投过票了')

  // 发起人要求填的信息必须在服务端校验：前端藏输入框不等于 API 调不到。
  // 改票时允许沿用上一次填过的内容，避免老用户改票被卡住。
  const info = String(profileInfo ?? '').trim()
  if (poll.profile_field && !info && !existing?.profile_info) {
    throw new HttpError(400, `请填写${poll.profile_field}`)
  }
  if (info.length > 200) throw new HttpError(400, '个人信息最多 200 字')
  const storedInfo = info || existing?.profile_info || null

  // 限 IP 只在首次投票时判断；改票不该被自己上一次的 IP 挡住
  if (!existing && poll.limit_ip && ip) {
    const dup = await db
      .prepare('SELECT 1 AS x FROM votes WHERE poll_id = ? AND ip = ? LIMIT 1')
      .bind(poll.id, ip)
      .first()
    if (dup) throw new HttpError(409, '同一网络下只能投一次')
  }

  const now = Date.now()
  const marks = optionIds.map(() => '?').join(',')
  const stmts: D1PreparedStatement[] = []

  if (existing) {
    // 改票：先把旧选择的票数减回去，再加新的，人数不变
    const oldIds = parseIds(existing.option_ids)
    if (oldIds.length) {
      stmts.push(
        db
          .prepare(
            `UPDATE options SET votes_count = MAX(0, votes_count - 1)
             WHERE poll_id = ? AND id IN (${oldIds.map(() => '?').join(',')})`
          )
          .bind(poll.id, ...oldIds)
      )
    }
    stmts.push(
      db
        .prepare(`UPDATE options SET votes_count = votes_count + 1 WHERE poll_id = ? AND id IN (${marks})`)
        .bind(poll.id, ...optionIds)
    )
    stmts.push(
      db
        .prepare('UPDATE votes SET option_ids = ?, profile_info = ?, ip = ?, created_at = ? WHERE id = ?')
        .bind(JSON.stringify(optionIds), storedInfo, ip, now, existing.id)
    )
  } else {
    stmts.push(
      db
        .prepare(`UPDATE options SET votes_count = votes_count + 1 WHERE poll_id = ? AND id IN (${marks})`)
        .bind(poll.id, ...optionIds)
    )
    stmts.push(
      db
        .prepare(
          `INSERT INTO votes (id, poll_id, user_id, option_ids, profile_info, ip, created_at)
           VALUES (?,?,?,?,?,?,?)`
        )
        .bind(newId('v'), poll.id, userId, JSON.stringify(optionIds), storedInfo, ip, now)
    )
    stmts.push(db.prepare('UPDATE polls SET voter_count = voter_count + 1 WHERE id = ?').bind(poll.id))
  }

  await db.batch(stmts)

  // 改票不重复通知，只有第一次投票才提醒发起人。
  // 通知失败只记日志：票已经投成功了，不能因为一条消息让用户以为投票失败。
  if (!existing) {
    await notifyJoined(db, poll, userId, 'vote', undefined, env).catch((err) =>
      console.error('[notify] vote joined failed', err)
    )
  }
}

export async function revokeVote(
  db: D1Database,
  poll: PollRowJoined,
  userId: string
): Promise<void> {
  assertPollOpen(poll)
  if (!poll.allow_edit) throw new HttpError(403, '发起人未开启修改选择')

  const existing = await db
    .prepare('SELECT id, option_ids FROM votes WHERE poll_id = ? AND user_id = ?')
    .bind(poll.id, userId)
    .first<{ id: string; option_ids: string }>()
  if (!existing) throw new HttpError(404, '你还没有投票')

  const oldIds = parseIds(existing.option_ids)
  const stmts: D1PreparedStatement[] = [
    db.prepare('DELETE FROM votes WHERE id = ?').bind(existing.id),
    db.prepare('UPDATE polls SET voter_count = MAX(0, voter_count - 1) WHERE id = ?').bind(poll.id)
  ]
  if (oldIds.length) {
    stmts.push(
      db
        .prepare(
          `UPDATE options SET votes_count = MAX(0, votes_count - 1)
           WHERE poll_id = ? AND id IN (${oldIds.map(() => '?').join(',')})`
        )
        .bind(poll.id, ...oldIds)
    )
  }

  await db.batch(stmts)
}

export async function myVote(db: D1Database, pollId: string, userId: string): Promise<string[]> {
  const row = await db
    .prepare('SELECT option_ids FROM votes WHERE poll_id = ? AND user_id = ?')
    .bind(pollId, userId)
    .first<{ option_ids: string }>()
  return parseIds(row?.option_ids)
}
