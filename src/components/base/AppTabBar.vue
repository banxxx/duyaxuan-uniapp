<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import { getSafeArea } from '@/utils/platform'
import { switchTab, TAB_HOME, TAB_ME } from '@/utils/tab'
import { go, ROUTES } from '@/utils/router'

/**
 * 底部 Tab：发现 / 创建（中间凸起主操作）/ 我的
 * 设计稿：64 高 + 顶部 1px 发丝线；创建是 46 的紫色圆按钮，在栏里垂直居中。
 *
 * 不用原生 tabBar 是因为中间那颗凸起按钮原生做不了。
 * 但「发现 / 我的」在 pages.json 里仍然是 tabBar 页（tabBar.custom = true，
 * 原生栏不渲染）—— 只有这样 switchTab 才成立，切 tab 不会销毁重建页面。
 */
defineProps<{ current: 'discover' | 'me' }>()

/** 底部小横条高度：栏高 64 + 安全区，用 getSafeArea 量出，不用不可靠的 env() */
const safeBottom = computed(() => `${getSafeArea().safeBottom}px`)

function onTab(page: 'discover' | 'me' | 'create') {
  if (page === 'create') {
    go(ROUTES.createType)
    return
  }
  switchTab(page === 'discover' ? TAB_HOME : TAB_ME)
}
</script>

<template>
  <view class="tabbar" :style="{ height: `calc(64px + ${safeBottom})`, paddingBottom: safeBottom }">
    <view class="tabbar__hairline" />
    <view class="tabbar__item" @tap="onTab('discover')">
      <AppIcon name="compass" :size="23" :color="current === 'discover' ? '#4F46E5' : '#A1A1AA'" />
      <text
        class="tabbar__label"
        :class="{ 'tabbar__label--active': current === 'discover' }"
        >发现</text
      >
    </view>

    <view class="tabbar__item tabbar__item--center" @tap="onTab('create')">
      <view class="tabbar__create">
        <AppIcon name="plus" :size="22" color="#FFFFFF" :stroke-width="2" />
      </view>
    </view>

    <view class="tabbar__item" @tap="onTab('me')">
      <AppIcon name="user" :size="23" :color="current === 'me' ? '#4F46E5' : '#A1A1AA'" />
      <text class="tabbar__label" :class="{ 'tabbar__label--active': current === 'me' }">我的</text>
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'AppTabBar' }
</script>

<style lang="scss" scoped>
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  /* 高度与下边距由内联 style 按 getSafeArea().safeBottom 给，避免 env() 在真机/工具里不一致 */
  display: flex;
  padding: 0 10px;
  background: $surface;
  z-index: 90;

  &__hairline {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: $line;
  }

  &__item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    position: relative;

    /* 创建按钮不参与图标 + 文案那一列，自己垂直居中 */
    &--center {
      justify-content: center;
    }
  }

  &__label {
    font-size: 11px;
    font-weight: 500;
    color: $faint;
    line-height: 1;

    &--active {
      color: $accent;
      font-weight: 600;
    }
  }

  &__create {
    width: 46px;
    height: 46px;
    border-radius: 23px;
    background: $accent;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}
</style>

