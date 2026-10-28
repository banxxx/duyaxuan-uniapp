import { ref, watch, onUnmounted, type Ref } from 'vue'

/**
 * 面板的「在场」状态：让 v-if 控制的面板先播完退场动画再卸载。
 *
 * 小程序里没有 <Transition>，元素一旦从树上摘掉，CSS 动画就没有载体了，
 * 表现就是「打开时滑上来，关闭时啪一下消失」。这里自己维护两个状态：
 *
 *   rendered —— 是否还挂在树上（退场动画播完才置 false）
 *   closing  —— 是否正在退场（根节点据此加类名，触发 --out 动画）
 *
 * 用法：
 *   const { rendered, closing } = usePresence(toRef(props, 'visible'))
 *   <view v-if="rendered" :class="{ 'sheet--closing': closing }">
 *
 * duration 要和 CSS 里的 $dur-base 对齐，动画播完了才卸载，
 * 短了会被截断，长了会多留一段不可交互的遮罩。
 */
export function usePresence(visible: Ref<boolean>, duration = 220) {
  const rendered = ref(visible.value)
  const closing = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  function stopTimer() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  watch(visible, (open) => {
    stopTimer()

    if (open) {
      // 退场途中又被打开：撤掉 closing，动画名换回进场那套，会从头播一遍
      closing.value = false
      rendered.value = true
      return
    }

    if (!rendered.value) return

    closing.value = true
    timer = setTimeout(() => {
      rendered.value = false
      closing.value = false
      timer = null
    }, duration)
  })

  // 页面/组件先没了，定时器再回调也没意义
  onUnmounted(stopTimer)

  return { rendered, closing }
}
