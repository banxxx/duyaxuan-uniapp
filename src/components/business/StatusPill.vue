<script setup lang="ts">
import { computed } from 'vue'
import type { PollStatus } from '@/types/api'

/**
 * 状态胶囊：进行中 / 已结束
 * 设计稿：20 高、圆角 6、内边距 [3,8]、圆点 5、字 10/600
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
  }>(),
  {}
)

const text = computed(() => props.label ?? (props.status === 'ongoing' ? '进行中' : '已结束'))
const tone = computed(() => props.tone ?? props.status)
</script>

<template>
  <view class="pill" :class="`pill--${tone}`">
    <view class="pill__dot" />
    <text class="pill__text">{{ text }}</text>
  </view>
</template>

<script lang="ts">
export default { name: 'StatusPill' }
</script>

<style lang="scss" scoped>
/* 设计稿：pill 没有固定高度，由 padding [3,8] 撑开 */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 6px;
  flex-shrink: 0;

  &__dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
  }

  &__text {
    font-size: 10px;
    font-weight: 600;
    line-height: 1.2;
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
