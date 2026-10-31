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
  unionid?: string,
  /** 只在首次建号时使用；已有账号不会被登录方覆盖昵称 */
  displayName?: string
): Promise<UserRow> {
  const now = Date.now()
  const existing = await findByPlatform(db, platform, openid)

  if (existing && existing.status === 0) {
    await db.prepare('UPDATE users SET updated_at = ? WHERE id = ?').bind(now, existing.id).run()
    return existing
  }

  const id = newId('u')
  const preferred = typeof displayName === 'string' ? displayName.trim().slice(0, 20) : ''
  const row: UserRow = {
    id,
    nickname: preferred || `用户${id.slice(-4).toUpperCase()}`,
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
    const avatar = patch.avatar ? String(patch.avatar) : null
    // 头像只能是本人上传目录下的文件：否则可以把头像设成别人的文件 /
    // 小程序码，下一次上传头像时旧图删除逻辑会把那个对象一起删掉。
    if (avatar && !avatar.startsWith(`/files/avatars/${userId}/`)) {
      throw new HttpError(400, '头像地址不合法')
    }
    fields.push('avatar = ?')
    values.push(avatar)
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
    db.prepare('DELETE FROM user_platforms WHERE user_id = ?').bind(userId),
    // 注销页承诺「清除身份信息」：参与记录保留（不影响统计），
    // 但发起人要求填的个人信息属于身份信息，要一起清掉。
    db.prepare('UPDATE votes SET profile_info = NULL WHERE user_id = ?').bind(userId),
    db.prepare('UPDATE answers SET profile_info = NULL WHERE user_id = ?').bind(userId),
    // 推送相关的临时数据没有保留价值
    db.prepare('DELETE FROM poll_reminders WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM wx_subscriptions WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM wx_push_prefs WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM wx_push_log WHERE user_id = ?').bind(userId)
  ])
}

/**
 * 给当前账号追加一种登录方式（绑定）。
 *
 * 一个 openid 只能属于一个账号：如果它已经绑在别的账号上就直接拒绝，
 * 否则会出现「两个账号共用同一种登录」——登录时 findByPlatform 只能命中一个，
 * 另一个人会莫名登录进别人的号。
 */
export async function bindPlatform(
  db: D1Database,
  userId: string,
  platform: string,
  openid: string,
  unionid?: string
): Promise<UserProfileOut> {
  const owner = await findByPlatform(db, platform, openid)
  if (owner) {
    // 已绑在当前账号上：幂等，直接返回，别报错吓用户
    if (owner.id === userId) return getProfile(db, userId)
    throw new HttpError(409, '该登录方式已绑定到其他账号')
  }

  await db
    .prepare(
      `INSERT INTO user_platforms (user_id, platform, openid, unionid, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(userId, platform, openid, unionid ?? null, Date.now())
    .run()
  return getProfile(db, userId)
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
