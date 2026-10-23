<script setup lang="ts">
import { computed } from 'vue'
import { iconSrc } from '@/utils/icon'

/**
 * 图标：把 lucide 路径渲染成 data URI 交给 <image>。
 * 小程序不支持内联 svg，这个方案在微信/QQ/抖音三端表现一致。
 */
const props = withDefaults(
  defineProps<{
    name: string
    size?: number | string
    color?: string
    strokeWidth?: number
  }>(),
  { size: 18, color: '#09090B', strokeWidth: 1.75 }
)

const px = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size))
const src = computed(() => iconSrc(props.name, props.color, props.strokeWidth))
</script>

<template>
  <image class="app-icon" :src="src" :style="{ width: px, height: px }" mode="aspectFit" />
</template>

<script lang="ts">
export default { name: 'AppIcon' }
</script>

<style lang="scss" scoped>
.app-icon {
  display: block;
  flex-shrink: 0;
}
</style>
