<script setup lang="ts">
import { computed } from 'vue'

/**
 * 三步进度条（创建 / 编辑流程共用）
 *
 * 设计稿：3 高轨道 + 下面一行「1 方式 · 2 内容 · 3 规则」。
 * 进度条宽度按当前步算，不按比例补间——三步就是 1/3、2/3、3/3。
 */
const props = defineProps<{
  current: 1 | 2 | 3
  labels?: [string, string, string]
}>()

const labels = computed(() => props.labels ?? ['方式', '内容', '规则'])
const width = computed(() => `${(props.current / 3) * 100}%`)
</script>

<template>
  <view class="steps">
    <view class="steps__track">
      <view class="steps__progress" :style="{ width }" />
    </view>
    <view class="steps__labels">
      <view
        v-for="(label, i) in labels"
        :key="label"
        class="steps__item"
        :class="{
          'steps__item--done': i + 1 < current,
          'steps__item--on': i + 1 === current
        }"
      >
        <text class="steps__num">{{ i + 1 }}</text>
        <text class="steps__text">{{ label }}</text>
      </view>
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'StepBar' }
</script>

<style lang="scss" scoped>
.steps {
  display: flex;
  flex-direction: column;
  gap: 9px;

  &__track {
    height: 3px;
    border-radius: 2px;
    background: $line;
    overflow: hidden;
  }

  &__progress {
    height: 100%;
    border-radius: 2px;
    background: $accent;
    transition: width 0.3s ease;
  }

  &__labels {
    display: flex;
    justify-content: space-between;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 5px;

    /* 第一步靠左、第三步靠右，中间那步居中 */
    &:nth-child(2) {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
    }
  }

  &__labels {
    position: relative;
  }

  &__num {
    font-size: 10px;
    font-weight: 700;
    color: $faint;
  }

  &__text {
    font-size: 10px;
    color: $faint;
  }

  &__item--on &__num,
  &__item--on &__text {
    color: $accent;
  }

  &__item--on &__text {
    font-weight: 600;
  }

  &__item--done &__num,
  &__item--done &__text {
    color: $muted;
  }
}
</style>
