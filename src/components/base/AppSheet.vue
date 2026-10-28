<script setup lang="ts">
import { computed, toRef } from 'vue'
import { bottomInset } from '@/utils/platform'
import { usePresence } from '@/utils/presence'

/**
 * 底部弹层
 *
 * 设计稿里所有弹层都是同一个骨架（16/32/33/34/35/36/37/38/89）：
 * 40% 黑色遮罩 + 白色面板，上沿 20 圆角、内边距 [10,20,24,20]、竖向间距 16，
 * 顶部一根 36×4 的把手，标题 18/700、说明 12/$faint，底部按钮区。
 * 92/95 两个删除确认面板的标题是 17/600，所以单独给 titleSize 开关。
 *
 * 不用 uni.showModal：原生弹窗的圆角、间距、按钮排布都改不了，和设计稿对不上。
 */
const props = withDefaults(
  defineProps<{
    visible: boolean
    title?: string
    desc?: string
    /** 点遮罩关闭，确认类弹层可以关掉，避免误触退出 */
    maskClosable?: boolean
    /** 92/95 的确认面板标题比常规弹层小一号 */
    titleSize?: 'lg' | 'md'
    /**
     * 49/56/57 的系统确认框骨架：上沿 24 圆角、内边距 [24,20,28,20]，
     * 标题 17/700、按钮 50 高 14 圆角。常规弹层（16/32-38/89）走默认值。
     */
    variant?: 'sheet' | 'confirm'
  }>(),
  { maskClosable: true, titleSize: 'lg', variant: 'sheet' }
)

const emit = defineEmits<{ (e: 'close'): void }>()

/**
 * 关闭时先播 220ms 退场再卸载 —— 打开是滑上来 + 遮罩淡入，
 * 关闭就该滑下去 + 遮罩淡出，而不是原地消失。
 */
const { rendered, closing } = usePresence(toRef(props, 'visible'))

/** 面板下边距：设计稿 24 再叠底部小横条高度 */
const panelPaddingBottom = computed(() => bottomInset(24))

function onMask() {
  emit('close')
}
</script>

<template>
  <view v-if="rendered" class="sheet" :class="{ 'sheet--closing': closing }" @tap="maskClosable && onMask()">
    <!-- 遮罩单独一层：面板上滑时遮罩同时淡入，比整块一起位移更像原生 -->
    <view class="sheet__mask" />
    <view
      class="sheet__panel"
      :class="{ 'sheet__panel--confirm': variant === 'confirm' }"
      :style="variant !== 'confirm' ? { paddingBottom: panelPaddingBottom } : undefined"
      @tap.stop
    >
      <view class="sheet__handle"><view class="sheet__bar" /></view>

      <view v-if="title || desc" class="sheet__head" :class="{ 'sheet__head--confirm': variant === 'confirm' }">
        <view class="sheet__head-row">
          <text
            class="sheet__title"
            :class="{
              'sheet__title--md': titleSize === 'md',
              'sheet__title--confirm': variant === 'confirm'
            }"
          >{{ title }}</text>
          <!-- 33 的标题行右侧有一个 28×28 的关闭钮 -->
          <slot name="head-extra" />
        </view>
        <text v-if="desc" class="sheet__desc">{{ desc }}</text>
      </view>

      <view class="sheet__body">
        <slot />
      </view>

      <view v-if="$slots.footer" class="sheet__footer">
        <slot name="footer" />
      </view>
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'AppSheet' }
</script>

<style lang="scss" scoped>
.sheet {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: flex-end;

  /*
   * 退场：怎么进来的就怎么出去 —— 面板滑回屏幕外，遮罩同步淡掉。
   * 用 ease-in（先慢后快）收尾，和进场的 ease-out 正好对称。
   * pointer-events: none 是因为这 220ms 里遮罩还挂在树上，
   * 不该再拦着页面上的点击。
   */
  &--closing {
    pointer-events: none;

    .sheet__mask {
      animation: dyx-mask-out $dur-base $ease-in both;
    }

    .sheet__panel {
      animation: dyx-sheet-down $dur-base $ease-in both;
    }
  }

  /* 遮罩自己一层，只做透明度变化，不跟着面板位移 */
  &__mask {
    position: absolute;
    inset: 0;
    background: rgba(9, 9, 11, 0.4);
    animation: dyx-mask-in $dur-base $ease-out both;
  }

  &__panel {
    position: relative;
    width: 100%;
    background: $surface;
    border-radius: $r-sheet $r-sheet 0 0;
    /* 下边距由内联 style 的 bottomInset(24) 给，不再用 env() */
    padding: 10px $gutter 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-height: 86vh;
    animation: dyx-sheet-up $dur-base $ease-out both;

    /* 49/56/57：系统确认框的上沿更圆、头顶留白更多 */
    &--confirm {
      border-radius: 24px 24px 0 0;
      padding: 24px $gutter 28px;
      gap: 0;
    }
  }

  &__handle {
    height: 4px;
    display: flex;
    justify-content: center;
    flex-shrink: 0;
  }

  &__bar {
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: $line;
  }

  &__head {
    display: flex;
    flex-direction: column;
    gap: 4px;

    /* 49/56/57：标题下 8、标题上 18、按钮上 22 */
    &--confirm {
      padding: 18px 0 0;
      gap: 8px;
      margin-bottom: 22px;
    }
  }

  /* 标题与右侧关闭钮同一行 */
  &__head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  /* 设计稿弹层标题 18/700 */
  &__title {
    font-size: 18px;
    font-weight: 700;
    color: $ink;

    /* 92/95 的删除确认：17/600 */
    &--md {
      font-size: 17px;
      font-weight: 600;
    }

    /* 49/56/57：17/700 */
    &--confirm {
      font-size: 17px;
      font-weight: 700;
    }
  }

  &__desc {
    font-size: 12px;
    color: $faint;
    line-height: 1.55;
  }

  &__body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  &__footer {
    flex-shrink: 0;
  }
}
</style>
