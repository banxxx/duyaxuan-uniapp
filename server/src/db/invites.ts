import { newId } from '../lib/id'
import { HttpError } from '../lib/response'
import type { PollRowJoined } from '../types'

/**
 * 参与方式与邀请
 *
 * 两档就够用：
 *   link   —— 拿到链接的人都能参与
 *   invite —— 需要 6 位邀请码（链接 / 小程序码里会带上，也可以手动输入）
 *
 * 每次有人从分享进来，落一条 invites 记录（谁邀请的、谁进来了）。
 * 首页「待我投票」直接读这张表，不再靠「进行中 + 我没投」猜。
 */

/** 去掉容易看错的 I / O / 0 / 1 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const INVITE_CODE_LEN = 6

export function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(INVITE_CODE_LEN))
  let code = ''
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length]
  return code
}

/** 老数据里的 group / private 也算「需要邀请码」 */
export function isInviteOnly(poll: Pick<PollRowJoined, 'join_method'>): boolean {
  return poll.join_method === 'invite' || poll.join_method === 'private'
}

/** 发起人第一次打开分享页时才生成，避免给链接模式的投票白存一个码 */
export async function ensureInviteCode(db: D1Database, poll: PollRowJoined): Promise<string> {
  if (poll.invite_code) return poll.invite_code

  const code = newInviteCode()
  await db.prepare('UPDATE polls SET invite_code = ? WHERE id = ?').bind(code, poll.id).run()
  return code
}

/**
 * 记录一次「从分享进来」。
 *
 * 邀请码错了要报得明确一点 —— 用户是从链接点进来的，不应该只看到「无权参与」。
 */
export async function acceptInvite(
  db: D1Database,
  poll: PollRowJoined,
  userId: string,
  code?: string
): Promise<void> {
  // 发起人自己在预览，不需要记录
  if (poll.creator_id === userId) return

  // 已经进来过的人再点一次链接，不该再被要一次邀请码
  const existing = await db
    .prepare('SELECT 1 AS x FROM invites WHERE poll_id = ? AND invitee_id = ?')
    .bind(poll.id, userId)
    .first()
  if (existing) return

  const got = (code ?? '').trim().toUpperCase()
  let inviterId: string | null = null

  if (isInviteOnly(poll)) {
    const want = (poll.invite_code ?? '').toUpperCase()
    if (!want || got !== want) throw new HttpError(403, '需要邀请码才能参与')
    inviterId = poll.creator_id
  } else if (got) {
    // 链接模式也带了码：说明是从发起人那里转过来的，记下来源
    inviterId = poll.creator_id
  }

  await db
    .prepare(
      `INSERT INTO invites (id, poll_id, inviter_id, invitee_id, code, created_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(poll_id, invitee_id) DO NOTHING`
    )
    .bind(newId('iv'), poll.id, inviterId, userId, got || null, Date.now())
    .run()
}

/** 投票 / 回答前的兜底校验：邀请码模式的投票，没被邀请过就不能参与 */
export async function assertCanJoin(
  db: D1Database,
  poll: PollRowJoined,
  userId: string
): Promise<void> {
  if (!isInviteOnly(poll) || poll.creator_id === userId) return

  const row = await db
    .prepare('SELECT 1 AS x FROM invites WHERE poll_id = ? AND invitee_id = ?')
    .bind(poll.id, userId)
    .first()
  if (!row) throw new HttpError(403, '需要邀请码才能参与')
}
