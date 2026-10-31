<script setup lang="ts">
import { computed } from 'vue'
import type { PollType } from '@/types/api'
import AppIcon from '@/components/base/AppIcon.vue'

/**
 * 类型标识：单选 / 多选 / 问卷
 *
 * 和 StatusPill 成对出现（列表行 Top 内、状态胶囊右侧），
 * 两者共用同一套盒模型：固定高度 $pill-height、左右 8、圆角 $r-xs、
 * 字 10/600、行高 1 —— 高度不要靠上下 padding 撑，否则会和状态胶囊差一截。
 *   单选、多选 → $subtle 底 + $muted 字
 *   问卷      → $ink 实底 + 白字 + message-square-text 图标
 * 只有问卷是实底，扫一眼就能从列表里挑出来。
 *
 * size="sm" 用于 04 搜索结果卡片：16 高 / 圆角 4 / 图标 9，和 StatusPill sm 对齐。
 */
const props = withDefaults(
  defineProps<{
    type: PollType
    size?: 'md' | 'sm'
  }>(),
  { size: 'md' }
)

const label = computed(() => {
  switch (props.type) {
    case 'single':
      return '单选'
    case 'multiple':
      return '多选'
    case 'survey':
      return '问卷'
  }
})

const isSurvey = computed(() => props.type === 'survey')
const iconSize = computed(() => (props.size === 'sm' ? 9 : 11))
</script>

<template>
  <view class="type-badge" :class="[`type-badge--${size}`, { 'type-badge--survey': isSurvey }]">
    <AppIcon
      v-if="isSurvey"
      name="message-square-text"
      :size="iconSize"
      color="#FFFFFF"
      :stroke-width="2"
    />
    <text class="type-badge__text">{{ label }}</text>
  </view>
</template>

<script lang="ts">
export default { name: 'TypeBadge' }
</script>

<style lang="scss" scoped>
.type-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: $pill-height;
  padding: 0 8px;
  border-radius: $r-xs;
  box-sizing: border-box;
  flex-shrink: 0;
  background: $subtle;

  &--sm {
    height: 16px;
    gap: 4px;
    padding: 0 6px;
    border-radius: 4px;
  }

  &__text {
    font-size: $fs-10;
    font-weight: 600;
    /* 和 StatusPill 一样固定行高，两个标签才能严格同高 */
    line-height: 1;
    color: $muted;
  }

  &--survey {
    background: $ink;

    .type-badge__text {
      color: $white;
    }
  }
}
</style>
