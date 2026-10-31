<script setup lang="ts">
import { computed } from 'vue'

/**
 * 开关
 *
 * 设计稿：轨道 44×26、圆角 13；开 $accent、关 #D4D4D8；圆点 20，左右各留 3。
 * 锁定态（已有投票/回答，规则不能再改）轨道退回 $line 且不响应点击——
 * 设计稿 91 里被锁的「匿名投票」即使原本是开的，也画成灰轨道。
 */
const props = withDefaults(
  defineProps<{
    modelValue: boolean
    disabled?: boolean
  }>(),
  { disabled: false }
)

const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

// 禁用只影响能否点击，不改变显示——否则「总开关关了但子项存的是开」会显示成关，
// 用户下次打开总开关时会以为子项一直是关的。
const on = computed(() => props.modelValue)

function toggle() {
  if (props.disabled) return
  emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <view
    class="switch"
    :class="{ 'switch--on': on, 'switch--disabled': disabled }"
    :hover-class="disabled ? 'none' : 'switch--active'"
    @tap="toggle"
  >
    <view class="switch__knob" />
  </view>
</template>

<script lang="ts">
export default { name: 'AppSwitch' }
</script>

<style lang="scss" scoped>
.switch {
  width: 44px;
  height: 26px;
  border-radius: $r-full;
  background: $track;
  padding: 3px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  transition: background-color $dur-fast $ease-both;

  &--on {
    background: $accent;
  }

  /* 按下时圆点缩一点，松手回弹；位移和缩放分开写，避免切换时两段动画打架 */
  &--active &__knob {
    transform: scale(0.9);
  }

  &--on.switch--active &__knob {
    transform: translateX(18px) scale(0.9);
  }

  /* 锁定态：轨道灰掉，圆点仍停在原来的位置 */
  &--disabled {
    background: $line !important;
  }

  &--disabled &__knob {
    box-shadow: none;
  }

  &__knob {
    width: 20px;
    height: 20px;
    border-radius: $r-sm;
    background: $white;
    box-shadow: 0 1px 3px rgba(9, 9, 11, 0.16);
    transition:
      transform $dur-fast $ease-both,
      box-shadow $dur-fast $ease-both;
  }

  &--on &__knob {
    transform: translateX(18px);
  }
}
</style>
