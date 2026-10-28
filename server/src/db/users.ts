import type { UserRow, UserProfileOut } from '../types'
import { newId } from '../lib/id'
import { HttpError } from '../lib/response'

/** 行 → 前端 UserProfile。bound 由调用方查 user_platforms 后补上 */
export function toProfile(row: UserRow, bound = true): UserProfileOut {
  return {
    id: row.id,
    nickname: row.nickname,
    avatar: row.avatar ?? undefined,
    bio: row.bio ?? undefined,
    createdAt: row.created_at,
    bound
  }
}

export async function findById(db: D1Database, id: string): Promise<UserRow | null> {
  return (await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>()) ?? null
}

async function findByPlatform(
  db: D1Database,
  platform: string,
  openid: string
): Promise<UserRow | null> {
  return (
    (await db
      .prepare(
        `SELECT u.* FROM user_platforms p
         JOIN users u ON u.id = p.user_id
         WHERE p.platform = ? AND p.openid = ?`
      )
      .bind(platform, openid)
      .first<UserRow>()) ?? null
  )
}

/**
 * 登录即注册。
 *
 * 三种情况：
 *   1. 没注册过      → 建账号 + 建平台绑定
 *   2. 注册过、正常  → 直接返回（顺便刷 updated_at）
 *   3. 注册过、已注销 → 建一个新账号，把平台绑定转过去。
 *      老账号的数据留着（软删除），新账号从零开始 —— 这是注销该有的语义。
 */
export async function loginOrRegister(
  db: D1Database,
  platform: string,
  openid: string,
  unionid?: string
): Promise<UserRow> {
  const now = Date.now()
  const existing = await findByPlatform(db, platform, openid)

  if (existing && existing.status === 0) {
    await db.prepare('UPDATE users SET updated_at = ? WHERE id = ?').bind(now, existing.id).run()
    return existing
  }

  const id = newId('u')
  const row: UserRow = {
    id,
    nickname: `用户${id.slice(-4).toUpperCase()}`,
    avatar: null,
    bio: null,
    status: 0,
    created_at: now,
    updated_at: now
  }

  const stmts = [
    db
      .prepare(
        `INSERT INTO users (id, nickname, avatar, bio, status, created_at, updated_at)
         VALUES (?, ?, NULL, NULL, 0, ?, ?)`
      )
      .bind(id, row.nickname, now, now)
  ]

  stmts.push(
    existing
      ? db
          .prepare('UPDATE user_platforms SET user_id = ? WHERE platform = ? AND openid = ?')
          .bind(id, platform, openid)
      : db
          .prepare(
            `INSERT INTO user_platforms (user_id, platform, openid, unionid, created_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .bind(id, platform, openid, unionid ?? null, now)
  )

  await db.batch(stmts)
  return row
}

export async function countBindings(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM user_platforms WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

export async function getProfile(db: D1Database, userId: string): Promise<UserProfileOut> {
  const row = await findById(db, userId)
  if (!row) throw new HttpError(404, '账号不存在')
  return toProfile(row, (await countBindings(db, userId)) > 0)
}

export async function updateProfile(
  db: D1Database,
  userId: string,
  patch: { nickname?: unknown; avatar?: unknown; bio?: unknown }
): Promise<UserProfileOut> {
  const fields: string[] = []
  const values: (string | number | null)[] = []

  if (patch.nickname !== undefined) {
    const nickname = String(patch.nickname).trim()
    if (!nickname) throw new HttpError(400, '昵称不能为空')
    fields.push('nickname = ?')
    values.push(nickname.slice(0, 20))
  }
  if (patch.avatar !== undefined) {
    fields.push('avatar = ?')
    values.push(patch.avatar ? String(patch.avatar) : null)
  }
  if (patch.bio !== undefined) {
    fields.push('bio = ?')
    values.push(String(patch.bio).trim().slice(0, 80) || null)
  }

  if (fields.length) {
    fields.push('updated_at = ?')
    values.push(Date.now())
    await db
      .prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values, userId)
      .run()
  }

  return getProfile(db, userId)
}

/**
 * 注销账号。
 *
 * 处理方式：
 *   - 账号本身打 status = 1 并清掉昵称/头像（不可再登录）
 *   - 自己发起的投票软删除（别人再打开就是 404）
 *   - 平台绑定删掉（重新登录会走「注册新账号」分支）
 *
 * 投票记录和问卷回答**保留**：它们是别人投票结果的一部分，
 * 删掉会让别人页面上的百分比凭空变化。身份信息已在 users 表清空，
 * 匿名投票下这些记录本来也不带身份。
 */
export async function deactivate(db: D1Database, userId: string): Promise<void> {
  const now = Date.now()
  await db.batch([
    db
      .prepare(
        `UPDATE users SET status = 1, nickname = '已注销用户', avatar = NULL, bio = NULL, updated_at = ?
         WHERE id = ?`
      )
      .bind(now, userId),
    db
      .prepare('UPDATE polls SET deleted_at = ? WHERE creator_id = ? AND deleted_at IS NULL')
      .bind(now, userId),
    db.prepare('DELETE FROM user_platforms WHERE user_id = ?').bind(userId)
  ])
}

/** 解绑平台。最后一个绑定时也允许解 —— 用户就是想彻底断开，前端会提示 */
export async function unbindPlatform(
  db: D1Database,
  userId: string,
  platform: string
): Promise<UserProfileOut> {
  await db
    .prepare('DELETE FROM user_platforms WHERE user_id = ? AND platform = ?')
    .bind(userId, platform)
    .run()
  return getProfile(db, userId)
}
