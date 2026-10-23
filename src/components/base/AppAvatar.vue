<script setup lang="ts">
import { computed } from 'vue'

/**
 * 头像：有图显示图，没图显示昵称首字（设计稿里的「周」「林」）
 * 底色 $accent-soft，字色 $accent-ink
 * 字号按设计稿实测约 0.38 倍头像尺寸（34→13、44→17、52→20、84→32）
 */
const props = withDefaults(
  defineProps<{
    src?: string
    name?: string
    size?: number
  }>(),
  { size: 40 }
)

const initial = computed(() => (props.name ? props.name.slice(0, 1) : '?'))
const px = computed(() => `${props.size}px`)
const fontSize = computed(() => `${Math.round(Number(props.size) * 0.38)}px`)
</script>

<template>
  <view class="avatar" :style="{ width: px, height: px, fontSize }">
    <image v-if="src" class="avatar__img" :src="src" mode="aspectFill" />
    <text v-else class="avatar__text">{{ initial }}</text>
  </view>
</template>

<script lang="ts">
export default { name: 'AppAvatar' }
</script>

<style lang="scss" scoped>
.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: $accent-soft;
  overflow: hidden;
  flex-shrink: 0;

  &__img {
    width: 100%;
    height: 100%;
  }

  &__text {
    color: $accent-ink;
    font-weight: 600;
    line-height: 1;
  }
}
</style>
