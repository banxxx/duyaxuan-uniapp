<script setup lang="ts">
import AppIcon from '@/components/base/AppIcon.vue'

/**
 * 列表行底部的指标：图标 + 数字
 * 设计稿：图标 12、间距 4、字 11/$muted
 */
withDefaults(
  defineProps<{
    icon: string
    value: string | number
  }>(),
  {}
)
</script>

<template>
  <view class="stat">
    <AppIcon :name="icon" :size="12" color="#A1A1AA" :stroke-width="1.75" />
    <text class="stat__text">{{ value }}</text>
  </view>
</template>

<script lang="ts">
export default { name: 'StatItem' }
</script>

<style lang="scss" scoped>
.stat {
  display: flex;
  align-items: center;
  gap: 4px;

  &__text {
    font-size: $fs-11;
    color: $muted;
    line-height: 1;
  }
}
</style>
