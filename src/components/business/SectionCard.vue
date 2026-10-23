<script setup lang="ts">
/**
 * 白卡分组
 *
 * 设置页、规则页、创建页都是「标题 + 一张白卡里若干行」的结构。
 * 卡片：白底、1px $line、圆角 16；行与行之间一条内缩 16 的分割线。
 */
withDefaults(
  defineProps<{
    title?: string
    /** 标题右侧的补充说明 */
    hint?: string
    /** 去掉内边距，让行自己控制（列表行需要贴边点击） */
    flush?: boolean
  }>(),
  { flush: false }
)
</script>

<template>
  <view class="section">
    <view v-if="title || $slots.extra" class="section__head">
      <text v-if="title" class="section__title">{{ title }}</text>
      <text v-if="hint" class="section__hint">{{ hint }}</text>
      <slot name="extra" />
    </view>

    <view class="section__card" :class="{ 'section__card--flush': flush }">
      <slot />
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'SectionCard' }
</script>

<style lang="scss" scoped>
.section {
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 0 2px;
  }

  &__title {
    font-size: 13px;
    font-weight: 600;
    color: $ink;
  }

  &__hint {
    font-size: 11px;
    color: $faint;
  }

  &__card {
    background: $surface;
    border: 1px solid $line;
    border-radius: 16px;
    padding: 0 16px;

    &--flush {
      padding: 0;
      overflow: hidden;
    }
  }
}
</style>
