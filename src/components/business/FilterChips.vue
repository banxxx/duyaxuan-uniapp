<script setup lang="ts">
/**
 * 状态筛选胶囊：全部 / 进行中 / 已结束
 * 设计稿：31 高、圆角 16、内边距 [7,13]、字 12；选中为 $accent 实底白字
 */
defineProps<{
  modelValue: string
  options: Array<{ value: string; label: string }>
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()
</script>

<template>
  <view class="chips">
    <view
      v-for="opt in options"
      :key="opt.value"
      class="chips__item"
      :class="{ 'chips__item--on': modelValue === opt.value }"
      hover-class="is-pressed"
      @tap="emit('update:modelValue', opt.value)"
    >
      <text class="chips__text" :class="{ 'chips__text--on': modelValue === opt.value }">
        {{ opt.label }}
      </text>
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'FilterChips' }
</script>

<style lang="scss" scoped>
.chips {
  display: flex;
  align-items: center;
  gap: 8px;

  /* 设计稿 Chip：padding [7,13]、圆角 16、字 12 —— 高度由内边距撑开，不写死 */
  &__item {
    padding: 7px 13px;
    border-radius: 16px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    transition:
      background-color $dur-fast $ease-both,
      border-color $dur-fast $ease-both;

    &--on {
      background: $accent;
      border-color: $accent;
    }
  }

  &__text {
    font-size: 12px;
    font-weight: 500;
    color: $muted;
    line-height: 1;
    transition: color $dur-fast $ease-both;

    &--on {
      color: #fff;
      font-weight: 600;
    }
  }
}
</style>
