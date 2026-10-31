<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import { getSafeArea } from '@/utils/platform'
import { back as goBack } from '@/utils/router'

/**
 * 自定义导航栏（默认吸顶）
 *
 * 设计稿：状态栏（系统高度）+ 52 高导航条，标题居中，左侧返回、右侧操作。
 *
 * 两件事必须按真机来，不能照抄设计稿：
 *
 * 1. 让开胶囊。微信/QQ/抖音右上角都有胶囊（约 87×32），右侧操作会被盖住。
 *    量出胶囊左边界，把导航条的右内边距撑到那里，操作按钮就落在胶囊左边。
 *
 * 2. 和胶囊对齐。导航条高度不是写死 52，而是按「胶囊上下留白相等」算出来
 *    （见 platform.ts 的 navBarHeight）。这样左侧返回键、右侧操作、
 *    系统胶囊三者的中心落在同一条水平线上，看起来才规范。
 *
 * 吸顶：导航栏本身 position: fixed，外层容器撑出等高把内容顶下来，
 * 否则第一屏会被盖住。
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
    /**
     * 是否吸顶。默认 true —— 设计稿所有二级页的导航条都是固定的，
     * 只有内容区在滚。页面若用整页滚动（没有 scroll-view），必须保持 true。
     */
    fixed?: boolean
    /** 吸顶时底部是否加一条发丝线，滚动内容贴上来时用 */
    hairline?: boolean
  }>(),
  { back: true, align: 'center', surface: false, fixed: true, hairline: false }
)

const emit = defineEmits<{ (e: 'back'): void }>()

const GUTTER = 20

const { statusBarHeight, capsuleInset, navBarHeight } = getSafeArea()

/** 导航条总高（含状态栏），页面据此留占位 */
const totalHeight = computed(() => `${statusBarHeight + navBarHeight}px`)

/** 右侧要让开胶囊，状态栏高度由外层 .nav 的 paddingTop 负责 */
const barStyle = computed(() => ({
  height: `${navBarHeight}px`,
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
  goBack()
}
</script>

<template>
  <!--
    单根节点：小程序端对多根节点组件支持有限（class/style 透传、样式隔离都会出问题），
    所以占位不用兄弟节点，而是让外层容器自己撑出导航条的高度。
    吸顶时 .nav 是 fixed（脱离文档流），外层容器的等高就把内容顶到导航条下面。
  -->
  <view class="nav-wrap" :style="{ height: fixed ? totalHeight : undefined }">
    <view
      class="nav"
      :class="{ 'nav--fixed': fixed, 'nav--surface': surface, 'nav--hairline': hairline }"
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
  </view>
</template>

<script lang="ts">
export default { name: 'AppNavBar' }
</script>

<style lang="scss" scoped>
.nav-wrap {
  flex-shrink: 0;
}

.nav {
  width: 100%;
  background: $bg;
  flex-shrink: 0;
  /* 发丝线是 .nav::after 绝对定位，非吸顶（fixed=false）时也要有定位父级 */
  position: relative;

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

  &--hairline::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 1px;
    background: $line;
  }

  /* 高度由内联 style 按胶囊算，不再写死 52 —— 见 platform.ts 的 navBarHeight */
  &__bar {
    position: relative;
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

  /* 设计稿：34×34、圆 17、白底、1px $line */
  &__btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: $r-circle;
    background: $surface;
    border: 1px solid $line;
    transition:
      opacity $dur-fast $ease-both,
      transform $dur-fast $ease-both;

    &--active {
      opacity: 0.7;
      transform: scale(0.94);
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
    font-size: $fs-16;
    font-weight: 600;
    color: $ink;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}
</style>
