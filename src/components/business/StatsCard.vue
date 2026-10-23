<script setup lang="ts">
/**
 * 三宫格统计卡：8 进行中 | 5 已结束 | 1.3k 总参与
 * 设计稿：白卡、圆角 16、纵向 padding 14，中间竖线分隔
 */
defineProps<{
  items: Array<{ value: string | number; label: string }>
}>()
</script>

<template>
  <view class="stats">
    <template v-for="(item, i) in items" :key="item.label">
      <view v-if="i > 0" class="stats__sep" />
      <view class="stats__item">
        <text class="stats__value">{{ item.value }}</text>
        <text class="stats__label">{{ item.label }}</text>
      </view>
    </template>
  </view>
</template>

<script lang="ts">
export default { name: 'StatsCard' }
</script>

<style lang="scss" scoped>
.stats {
  display: flex;
  align-items: center;
  padding: 14px 0;
  background: $surface;
  border: 1px solid $line;
  border-radius: 16px;

  &__item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  &__sep {
    width: 1px;
    height: 24px;
    background: $line;
  }

  &__value {
    font-size: 19px;
    font-weight: 700;
    color: $ink;
    font-family: $font-num;
    line-height: 1.2;
  }

  &__label {
    font-size: 10px;
    color: $faint;
  }
}
</style>
