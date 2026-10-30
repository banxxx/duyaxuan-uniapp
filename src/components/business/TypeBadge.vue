<script setup lang="ts">
import { computed } from 'vue'
import type { PollType } from '@/types/api'
import AppIcon from '@/components/base/AppIcon.vue'

/**
 * 类型标识：单选 / 多选 / 问卷
 *
 * 设计稿约定（列表行 Top 内、状态胶囊右侧）：
 *   18 高 / 圆角 5 / 内边距 [2,7] / 字 10-600
 *   单选、多选 → $subtle 底 + $muted 字
 *   问卷      → $ink 实底 + 白字 + message-square-text 图标
 * 只有问卷是实底，扫一眼就能从列表里挑出来。
 *
 * size="sm" 用于 04 搜索结果卡片：15 高 / 圆角 4 / 字 9 / 图标 9。
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
  gap: 4px;
  flex-shrink: 0;
  background: $subtle;
  border-radius: 5px;

  &--md {
    padding: 2px 7px;

    .type-badge__text {
      font-size: 10px;
    }
  }

  &--sm {
    padding: 1px 5px;
    border-radius: 4px;

    .type-badge__text {
      font-size: 9px;
    }
  }

  &__text {
    font-weight: 600;
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
