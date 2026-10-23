<script setup lang="ts">
import { ref } from 'vue'
import { getMenuButtonRect } from '@/utils/platform'

/**
 * 状态栏占位
 *
 * 设计稿里画的是 9:41 + 信号/WiFi/电池，但真机上这块由系统渲染，
 * 页面只需要留出高度。这里同时算出「状态栏 + 胶囊」的总高，供自定义导航栏用。
 */
const statusBarHeight = ref(20)

const info = uni.getSystemInfoSync()
statusBarHeight.value = info.statusBarHeight ?? 20

const { navHeight } = getMenuButtonRect()

defineExpose({ statusBarHeight, navHeight })
</script>

<template>
  <view class="status-bar" :style="{ height: `${statusBarHeight}px` }" />
</template>

<script lang="ts">
export default { name: 'AppStatusBar' }
</script>

<style lang="scss" scoped>
.status-bar {
  width: 100%;
  flex-shrink: 0;
  background: $bg;
}
</style>
