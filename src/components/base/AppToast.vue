<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import AppIcon from './AppIcon.vue'
import { mountToastHost, toastState, unmountToastHost } from '@/utils/toast'
import { usePresence } from '@/utils/presence'

/**
 * 全局轻提示（替代 uni.showToast）
 *
 * 深色胶囊 + 白字，成功/失败各带一个彩色图标，2 秒自动消失。
 * 每个页面放一个：<AppToast />，状态由 utils/toast.ts 统一管理。
 */
const { visible, message, kind } = toastState

/**
 * 退场：提示是「说完就走」的东西，直接摘掉会啪一下消失。
 * 和弹层共用 usePresence，先缩一下再卸载；160ms 对应 CSS 里的 $dur-fast。
 */
const { rendered, closing } = usePresence(visible, 160)

onMounted(mountToastHost)
onUnmounted(unmountToastHost)
</script>

<template>
  <view
    v-if="rendered"
    class="toast"
    :class="[`toast--${kind}`, { 'toast--closing': closing }]"
  >
    <AppIcon
      v-if="kind !== 'info'"
      :name="kind === 'success' ? 'circle-check' : 'triangle-alert'"
      :size="16"
      :color="kind === 'success' ? '#34D399' : '#F87171'"
      :stroke-width="2.2"
    />
    <text class="toast__text">{{ message }}</text>
  </view>
</template>

<script lang="ts">
export default { name: 'AppToast' }
</script>

<style lang="scss" scoped>
.toast {
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: 9999;
  max-width: 280px;
  padding: 12px 18px;
  border-radius: $r-md;
  background: rgba(9, 9, 11, 0.88);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  /* 轻提示不该挡住下面的按钮 */
  pointer-events: none;
  transform: translate(-50%, -50%);
  animation: toast-in $dur-fast $ease-out both;

  /* 退场：怎么进来的就怎么出去，收得比进场稍快一点 */
  &--closing {
    animation: toast-out $dur-fast $ease-in both;
  }

  &__text {
    font-size: $fs-14;
    line-height: 1.45;
    color: $white;
    text-align: center;
    word-break: break-word;
  }
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.94);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

@keyframes toast-out {
  from {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  to {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.96);
  }
}

@media (prefers-reduced-motion: reduce) {
  .toast {
    animation-duration: 1ms;
  }
}
</style>
