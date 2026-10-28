const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * 生成带前缀的短 id，例如 p_lqz3k8a1f9c2。
 *
 * 不用自增整数：投票 id 会出现在分享链接里，连号容易被遍历。
 * 时间戳保证大致有序（方便按 id 排序排查），随机段保证不可猜。
 */
export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let rand = ''
  for (const b of bytes) rand += ALPHABET[b % 36]
  return `${prefix}_${Date.now().toString(36)}${rand}`
}
