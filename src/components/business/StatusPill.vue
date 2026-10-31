<script setup lang="ts">
import { computed } from 'vue'
import type { PollStatus } from '@/types/api'

/**
 * 状态胶囊：进行中 / 已结束
 * 设计稿：20 高、圆角 6、内边距 [0,8]、圆点 5、字 10/600
 *
 * 和 TypeBadge 成对出现（列表行 Top 左侧），两者共用同一套盒模型：
 * 固定高度 $pill-height、左右 8、圆角 $r-xs、字 10/600、行高 1。
 * 不要再用上下 padding 撑高度 —— 不同平台的字体行高会把两个标签撑得不一样高。
 *
 * 41/02 说的是「这件事的状态」（进行中 / 已结束）；
 * 42 说的是「我和这件事的关系」，文案与配色都不同：
 *   已投票 → $accent-soft + $accent
 *   收集中 → $success-soft + $success
 *   已结束 → $subtle + $faint
 * 所以文案和色调都能从外面覆盖。
 */
const props = withDefaults(
  defineProps<{
    status: PollStatus
    /** 覆盖文案：42 的「已投票」「收集中」 */
    label?: string
    /** 覆盖配色 */
    tone?: 'ongoing' | 'ended' | 'accent'
    /** 和 TypeBadge 的 size 对齐：列表行 md，搜索结果 sm */
    size?: 'md' | 'sm'
  }>(),
  { size: 'md' }
)

const text = computed(() => props.label ?? (props.status === 'ongoing' ? '进行中' : '已结束'))
const tone = computed(() => props.tone ?? props.status)
</script>

<template>
  <view class="pill" :class="[`pill--${tone}`, `pill--${size}`]">
    <view class="pill__dot" />
    <text class="pill__text">{{ text }}</text>
  </view>
</template>

<script lang="ts">
export default { name: 'StatusPill' }
</script>

<style lang="scss" scoped>
/* 和 TypeBadge 共用同一套盒模型：固定高度 + 0 上下内边距，行高 1 */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: $pill-height;
  padding: 0 8px;
  border-radius: $r-xs;
  box-sizing: border-box;
  flex-shrink: 0;

  &__dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
  }

  &__text {
    font-size: $fs-10;
    font-weight: 600;
    /* 固定行高，避免中英文/不同平台字体把胶囊撑高 */
    line-height: 1;
  }

  /* 搜索结果等紧凑场景：和 TypeBadge sm 同高同圆角 */
  &--sm {
    height: 16px;
    gap: 4px;
    padding: 0 6px;
    border-radius: 4px;

    .pill__dot {
      width: 4px;
      height: 4px;
    }
  }

  &--ongoing {
    background: $success-soft;

    .pill__dot {
      background: $success;
    }

    .pill__text {
      color: $success;
    }
  }

  &--ended {
    background: $subtle;

    .pill__dot {
      background: $faint;
    }

    .pill__text {
      color: $faint;
    }
  }

  /* 42：我投过 / 问卷还在收集中 */
  &--accent {
    background: $accent-soft;

    .pill__dot {
      background: $accent;
    }

    .pill__text {
      color: $accent;
    }
  }
}
</style>
