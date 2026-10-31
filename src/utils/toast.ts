import { ref } from 'vue'

/**
 * 全局轻提示
 *
 * 为什么不直接用 uni.showToast：
 *   - 微信端是系统黑框，字号/圆角/留白都不受控，和设计稿对不上；
 *   - H5 端 uni-app 会渲染成另一套 DOM 样式，两端观感不一致；
 *   - 想给「成功」加一个对勾、「失败」加一个警示图标也做不到。
 *
 * 这里只维护状态，真正的 UI 在 components/base/AppToast.vue。
 * 因为 App.vue 不能写 template（它不是页面），每个页面都要放一个 <AppToast />。
 * 万一新页面忘了放，show() 会退回原生 toast，至少不会静默失败。
 */

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastOptions {
  /** 停留时长，默认 1800ms */
  duration?: number
}

export const toastState = {
  visible: ref(false),
  message: ref(''),
  kind: ref<ToastKind>('info')
}

let timer: ReturnType<typeof setTimeout> | null = null

/** 已挂载的 <AppToast /> 数量（tab 页会同时存在多个） */
let hostCount = 0

export function mountToastHost(): void {
  hostCount += 1
}

export function unmountToastHost(): void {
  hostCount = Math.max(0, hostCount - 1)
}

function show(text: string, kind: ToastKind, options: ToastOptions = {}): void {
  const title = String(text ?? '').trim()
  if (!title) return

  // 页面里没挂 AppToast：退回原生，避免提示丢失
  if (hostCount === 0) {
    uni.showToast({ title, icon: 'none' })
    return
  }

  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  toastState.message.value = title
  toastState.kind.value = kind
  toastState.visible.value = true
  timer = setTimeout(() => {
    toastState.visible.value = false
    timer = null
  }, options.duration ?? 1800)
}

export const toast = {
  /** 普通提示：校验、限制、引导说明 */
  show: (text: string, options?: ToastOptions) => show(text, 'info', options),
  /** 操作成功：保存、删除、复制 */
  success: (text: string, options?: ToastOptions) => show(text, 'success', options),
  /** 操作失败：接口错误、保存失败 */
  error: (text: string, options?: ToastOptions) => show(text, 'error', options)
}
