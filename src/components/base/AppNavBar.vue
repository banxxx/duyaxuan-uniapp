<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import { getSafeArea } from '@/utils/platform'
import { switchTab, TAB_HOME } from '@/utils/tab'

/**
 * 自定义导航栏
 *
 * 设计稿：状态栏（系统高度）+ 52 高导航条，标题居中，左侧返回、右侧操作。
 *
 * 真机上必须让开右上角的胶囊按钮（微信/QQ/抖音都有，约 87×32），
 * 否则右侧操作会被盖住。做法：量出胶囊左边界，把导航条的右内边距撑到那里，
 * 操作按钮就落在胶囊左边；标题用绝对定位在整条导航里居中，不受这个不对称影响。
 *
 * 量不到胶囊（H5、部分开发者工具）时退回设计稿的 20 内边距。
 */
withDefaults(
  defineProps<{
    title?: string
    /** 左侧返回；false 时留空位 */
    back?: boolean
    /** 标题居中（详情页）还是左对齐（列表页） */
    align?: 'center' | 'left'
    /** 背景：页面底 or 白卡 */
    surface?: boolean
    /** 是否吸顶 */
    fixed?: boolean
  }>(),
  { back: true, align: 'center', surface: false, fixed: false }
)

const emit = defineEmits<{ (e: 'back'): void }>()

const GUTTER = 20

const { statusBarHeight, capsuleInset } = getSafeArea()

/** 右侧要让开胶囊，状态栏高度由外层 .nav 的 paddingTop 负责 */
const barStyle = computed(() => ({
  paddingRight: `${capsuleInset > GUTTER ? capsuleInset : GUTTER}px`
}))

/**
 * 居中标题左右各让出 60（返回键 + 一个操作位的宽度）。
 * 两侧必须对称，否则胶囊一宽标题就被挤偏；长标题靠 ellipsis 截断。
 * 胶囊比 60 宽时按胶囊算，免得长标题钻到胶囊底下。
 */
const titleStyle = computed(() => {
  const inset = `${Math.max(60, capsuleInset)}px`
  return { paddingLeft: inset, paddingRight: inset }
})

function onBack() {
  emit('back')
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  // 返回栈到底了：首页是 tab 页，必须 switchTab，reLaunch 会重建整页
  else switchTab(TAB_HOME)
}
</script>

<template>
  <view
    class="nav"
    :class="{ 'nav--fixed': fixed, 'nav--surface': surface }"
    :style="{ paddingTop: `${statusBarHeight}px` }"
  >
    <view class="nav__bar" :style="barStyle">
      <view class="nav__left">
        <view v-if="back" class="nav__btn" hover-class="nav__btn--active" @tap="onBack">
          <AppIcon name="chevron-left" :size="18" color="#09090B" />
        </view>
        <slot name="left" />
      </view>

      <!-- 左对齐时标题跟在左侧按钮后面（创建流程的「取消」），走正常流式布局 -->
      <view v-if="align === 'left'" class="nav__title nav__title--left">
        <text class="nav__title-text">
          <slot name="title">{{ title }}</slot>
        </text>
      </view>

      <view class="nav__right">
        <slot name="right" />
      </view>

      <!-- 居中时标题绝对定位铺满，两侧按钮不参与它的排版 -->
      <view v-if="align === 'center'" class="nav__title nav__title--center" :style="titleStyle">
        <text class="nav__title-text">
          <slot name="title">{{ title }}</slot>
        </text>
      </view>
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'AppNavBar' }
</script>

<style lang="scss" scoped>
.nav {
  width: 100%;
  background: $bg;
  flex-shrink: 0;

  &--surface {
    background: $surface;
  }

  &--fixed {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
  }

  /* 设计稿：52 高、左右各 20 */
  &__bar {
    position: relative;
    height: $nav-height;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-left: $gutter;
  }

  &__left,
  &__right {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 34px;
    /* 压在标题之上，保证可点 */
    position: relative;
    z-index: 2;
  }

  &__right {
    justify-content: flex-end;
  }

  /* 设计稿：34×34、圆 16、白底、1px $line */
  &__btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 17px;
    background: $surface;
    border: 1px solid $line;

    &--active {
      opacity: 0.7;
    }
  }

  &__title {
    display: flex;
    align-items: center;
    min-width: 0;

    &--center {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      right: 0;
      justify-content: center;
      pointer-events: none;
      z-index: 1;
    }

    &--left {
      flex: 1;
      justify-content: flex-start;
      padding-left: 4px;
      z-index: 2;
    }
  }

  &__title-text {
    font-size: 16px;
    font-weight: 600;
    color: $ink;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}
</style>
