<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import AppIcon from './AppIcon.vue'
import { mountToastHost, toastState, unmountToastHost } from '@/utils/toast'

/**
 * 全局轻提示（替代 uni.showToast）
 *
 * 深色胶囊 + 白字，成功/失败各带一个彩色图标，2 秒自动消失。
 * 每个页面放一个：<AppToast />，状态由 utils/toast.ts 统一管理。
 */
const { visible, message, kind } = toastState

onMounted(mountToastHost)
onUnmounted(unmountToastHost)
</script>

<template>
  <view v-if="visible" class="toast" :class="`toast--${kind}`">
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

@media (prefers-reduced-motion: reduce) {
  .toast {
    animation-duration: 1ms;
  }
}
</style>
