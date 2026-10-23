<script setup lang="ts">
import AppIcon from '@/components/base/AppIcon.vue'

/**
 * 规则行
 *
 * 30/31/63/91/94 的每一行规则都是同一个结构：
 *   左侧标题 + 说明，右侧开关 / 值 / 选项组
 * 锁定态（已有投票/回答）标题转 $faint，说明换成「已有投票，不能再改」。
 *
 * 这一行只负责「长得对」，交互由父级通过 value / 点击事件驱动。
 */
withDefaults(
  defineProps<{
    title: string
    desc?: string
    /** 锁定：置灰、不可点 */
    locked?: boolean
    /** 右侧显示的当前值（如「部门」「投票后查看」） */
    value?: string
    /** 是否显示右侧箭头，表示点击会唤起弹层 */
    clickable?: boolean
  }>(),
  { locked: false, clickable: false }
)

const emit = defineEmits<{ (e: 'tap'): void }>()
</script>

<template>
  <view class="rule" :class="{ 'rule--locked': locked }" @tap.stop="!locked && clickable && emit('tap')">
    <view class="rule__main">
      <view class="rule__text">
        <text class="rule__title">{{ title }}</text>
        <text v-if="desc" class="rule__desc">{{ desc }}</text>
      </view>
      <slot />
      <view v-if="value" class="rule__value">
        <text class="rule__value-text">{{ value }}</text>
        <AppIcon v-if="clickable" name="chevron-right" :size="14" color="#A1A1AA" />
      </view>
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'RuleRow' }
</script>

<style lang="scss" scoped>
.rule {
  /* 设计稿：行内边距 [12,16]，分隔线通栏（卡片的左右内边距挪到这里） */
  padding: 12px 16px;

  & + & {
    border-top: 1px solid $line;
  }

  &__main {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__title {
    font-size: 14px;
    font-weight: 500;
    color: $ink;
  }

  &__desc {
    font-size: 11px;
    color: $faint;
    line-height: 1.45;
  }

  &__value {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }

  &__value-text {
    font-size: 12px;
    color: $muted;
  }

  /* 锁定：标题转 $faint（设计稿 91 锁定的「参与方式」右侧值仍是 $muted） */
  &--locked {
    .rule__title {
      color: $faint;
    }
  }
}
</style>
