/**
 * 邀请码
 *
 * 邀请码模式的投票/问卷，参与前要先「加入」。码由发起人单独告知，
 * 不随分享链接或小程序码传播 —— 这里负责三件事：
 *   1. 字符集 / 长度（和服务端 server/src/db/invites.ts 保持一致）
 *   2. 输入归一化：小写转大写、去掉空格、只留 6 位
 *   3. 「问用户要码」的弹层状态（视觉由 AppInviteCode 负责）
 *
 * 为什么不再用 uni.showModal：原生弹窗的圆角、间距、按钮排布都改不了，
 * 和项目里的 AppSheet 完全不是一套视觉。
 */

import { reactive } from 'vue'

/** 和服务端一致：去掉容易看错的 I / O / 0 / 1 */
export const INVITE_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const INVITE_CODE_LENGTH = 6

const VALID = new RegExp(`^[${INVITE_CODE_CHARSET}]{${INVITE_CODE_LENGTH}}$`)

/**
 * 小写转大写、去掉空格、截到 6 位。
 *
 * 这里故意不剔除非法字符：如果静默删掉，用户会看到「明明敲了 6 位却只剩 5 位」，
 * 反而不知道哪里错了。格式不对时由弹层给一句概括性的提示。
 */
export function normalizeInviteCode(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/\s+/g, '').slice(0, INVITE_CODE_LENGTH)
}

export function isValidInviteCode(code: string): boolean {
  return VALID.test(code)
}

/**
 * 从剪贴板文本里取出邀请码。
 *
 * 用户可能只复制了码，也可能复制了「邀请码：TEA238」这种整句，
 * 所以先按整段判断，再从文本里找第一个合法的 6 位串。
 */
export function extractInviteCode(raw: string): string | null {
  const text = (raw ?? '').toUpperCase()

  const whole = normalizeInviteCode(text)
  if (isValidInviteCode(whole)) return whole

  const tokens = text.replace(/[^A-Z0-9]+/g, ' ').split(' ')
  for (const token of tokens) {
    if (isValidInviteCode(token)) return token
  }
  return null
}

export interface InviteCodeOptions {
  /** 重新输入时带回上一次的值，省得用户从头敲 */
  initial?: string
  /**
   * 提交时先校验；返回错误文案就留在弹层里抖动提示，返回 null 才关闭。
   *
   * 校验放在页面侧执行，结果通过 state.validating / state.error 回传给弹层。
   * 不把函数直接当 props 传下去 —— 小程序端 props 会走 setData 序列化，函数会丢。
   */
  validate?: (code: string) => Promise<string | null>
}

/**
 * 邀请码弹层状态。
 *
 * 页面里的用法：
 *   const invite = useInviteCode()
 *   const code = await invite.ask({ validate: (c) => tryJoin(c) })
 *   <AppInviteCode :visible="invite.state.visible" ... @submit="invite.submit" />
 *
 * 同一时刻只保留一个待处理的 Promise：重复 ask 时先把上一个按「取消」结束，
 * 避免调用方永远等不到结果。
 */
export function useInviteCode() {
  const state = reactive({
    visible: false,
    initial: '',
    /** 正在校验（joinPoll 进行中），弹层据此显示按钮 loading */
    validating: false,
    /** 校验失败文案，弹层据此抖动并提示 */
    error: '',
    /**
     * 失败次数。文案相同也要能重新抖一次，所以单独给个递增序号，
     * 弹层监听它而不是监听 error 字符串本身。
     */
    errorSeq: 0
  })

  let pending: ((code: string | null) => void) | null = null
  let validate: ((code: string) => Promise<string | null>) | null = null

  function ask(opts: InviteCodeOptions = {}): Promise<string | null> {
    if (pending) {
      const previous = pending
      pending = null
      previous(null)
    }
    state.initial = opts.initial ?? ''
    state.validating = false
    state.error = ''
    state.errorSeq = 0
    validate = opts.validate ?? null
    state.visible = true
    return new Promise((resolve) => {
      pending = resolve
    })
  }

  /**
   * 弹层点「进入」时调用。
   *
   * 校验通过才关闭弹层并 resolve；校验失败只把错误写回 state，
   * 弹层留在原地抖动 —— 不会出现「收起再弹出」。
   */
  async function submit(code: string) {
    if (state.validating) return
    state.error = ''

    if (validate) {
      state.validating = true
      let error: string | null = null
      try {
        error = await validate(code)
      } catch {
        error = '网络异常，请稍后重试'
      } finally {
        state.validating = false
      }
      if (error) {
        state.error = error
        state.errorSeq += 1
        return
      }
    }

    state.visible = false
    settle(code)
  }

  function close() {
    if (state.validating) return
    state.visible = false
    settle(null)
  }

  function settle(code: string | null) {
    const resolve = pending
    pending = null
    validate = null
    resolve?.(code)
  }

  return { state, ask, close, submit }
}
