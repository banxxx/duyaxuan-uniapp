import { computed, onUnmounted, ref } from 'vue'
import type { UserProfile } from '@/types/api'
import {
  checkBindStatus,
  checkMixauthStatus,
  createBindQr,
  createMixauthQr,
  type MixauthProvider
} from '@/api/mixauth'

/**
 * 扫码登录 / 绑定的轮询状态机。
 *
 * 登录和绑定共用 MixauthQr 弹层，差别只有「调哪组接口」和「成功后做什么」，
 * 由调用方通过 options 传进来。
 */

export type QrState = 'loading' | 'waiting' | 'scanned' | 'denied' | 'expired' | 'timeout' | 'error'

export interface MixauthSuccessPayload {
  provider: MixauthProvider
  token?: string
  user?: UserProfile
}

export interface UseMixauthQrOptions {
  provider: () => MixauthProvider
  mode: () => 'login' | 'bind'
  /** 弹层关掉 / 页面离开后返回 false，用来丢弃已经过期的请求回调 */
  isActive: () => boolean
  onSuccess: (payload: MixauthSuccessPayload) => void
}

/** MixAuth 自己的轮询是 1 秒；1.5 秒一次足够快，也少给 Worker / Vercel 一点压力 */
const POLL_INTERVAL = 1500

/** 扫码后等手机端确认的上限；超过就按失败处理，提示刷新 */
const CONFIRM_TIMEOUT = 90_000

export function useMixauthQr(options: UseMixauthQrOptions) {
  const qrCode = ref('')
  const qrState = ref<QrState>('loading')

  let qrId = ''
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  /** 每次刷新 / 关闭 +1，用来丢弃已经过期的二维码请求和轮询回调 */
  let pollSeq = 0
  let pollFailures = 0
  /** 第一次看到「已扫码」的时间，用来算确认超时 */
  let scannedAt = 0

  const isScanned = computed(() => qrState.value === 'scanned')

  const isStale = computed(
    () =>
      qrState.value === 'expired' ||
      qrState.value === 'denied' ||
      qrState.value === 'timeout' ||
      qrState.value === 'error'
  )

  const stateText = computed(() => {
    switch (qrState.value) {
      case 'loading':
        return '正在生成二维码…'
      case 'waiting':
        return '用手机扫码后确认登录'
      case 'scanned':
        return '等待手机端确认…'
      case 'denied':
        return '你取消了本次登录'
      case 'expired':
        return '二维码已过期'
      case 'timeout':
        return '确认超时，请刷新二维码'
      case 'error':
        return '二维码加载失败，请检查网络'
      default:
        return ''
    }
  })

  const staleText = computed(() => {
    switch (qrState.value) {
      case 'denied':
        return '已取消'
      case 'expired':
        return '已过期'
      case 'timeout':
        return '已超时'
      default:
        return '加载失败'
    }
  })

  function stopPoll() {
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  /** 停掉轮询并让所有在途请求作废（关闭弹层 / 离开页面时调用） */
  function stop() {
    pollSeq++
    stopPoll()
  }

  async function start() {
    stopPoll()
    const seq = ++pollSeq
    qrCode.value = ''
    qrId = ''
    qrState.value = 'loading'
    pollFailures = 0
    scannedAt = 0

    try {
      const qr =
        options.mode() === 'bind'
          ? await createBindQr(options.provider())
          : await createMixauthQr(options.provider())
      if (seq !== pollSeq || !options.isActive()) return
      qrCode.value = qr.qrcode
      qrId = qr.id
      qrState.value = 'waiting'
      poll(seq)
    } catch {
      if (seq !== pollSeq || !options.isActive()) return
      qrState.value = 'error'
    }
  }

  function poll(seq: number) {
    stopPoll()
    pollTimer = setTimeout(async () => {
      if (seq !== pollSeq || !options.isActive()) return

      try {
        const res =
          options.mode() === 'bind'
            ? await checkBindStatus(options.provider(), qrId)
            : await checkMixauthStatus(options.provider(), qrId)
        if (seq !== pollSeq || !options.isActive()) return

        if (res.state === 'success') {
          stopPoll()
          const token = res.token
          const user = res.user
          // 结果不完整就当作失败，给重试入口而不是放一个坏状态过去
          if (options.mode() === 'bind' ? !user : !token || !user) {
            qrState.value = 'error'
            return
          }
          options.onSuccess({ provider: options.provider(), token, user })
          return
        }

        pollFailures = 0

        // 已扫码：遮罩盖住二维码等手机端确认。确认前不关；
        // 超过上限还没确认，就按失败处理，避免一直停在「等待确认」。
        if (res.state === 'scanned') {
          if (!scannedAt) scannedAt = Date.now()
          if (Date.now() - scannedAt >= CONFIRM_TIMEOUT) {
            stopPoll()
            qrState.value = 'timeout'
            return
          }
        } else {
          scannedAt = 0
        }

        qrState.value = res.state
        if (res.state === 'expired' || res.state === 'denied') {
          stopPoll()
          return
        }
        poll(seq)
      } catch {
        if (seq !== pollSeq || !options.isActive()) return
        // 单次网络抖动就判失败太脆；连着失败两次再让用户手动刷新
        pollFailures++
        if (pollFailures >= 2) {
          qrState.value = 'error'
          return
        }
        poll(seq)
      }
    }, POLL_INTERVAL)
  }

  /** 过期 / 被拒绝 / 加载失败时，点二维码重新申请一张 */
  function refresh() {
    if (isStale.value) start()
  }

  function onQrImageError() {
    // 微信二维码是外链图片；图挂了就没法扫，直接给重试入口
    stopPoll()
    pollSeq++
    qrState.value = 'error'
  }

  onUnmounted(stop)

  return {
    qrCode,
    qrState,
    isScanned,
    isStale,
    stateText,
    staleText,
    start,
    stop,
    refresh,
    onQrImageError
  }
}
