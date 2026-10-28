<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { resolveFileUrl } from '@/utils/api-base'
import { pickDefaultAvatar } from '@/utils/default-avatar'

/**
 * 头像
 *
 * 三种情况：
 *   1. 用户上传过      → 后端存的相对路径 /files/avatars/...，拼上 API 域名
 *   2. 没上传过        → 按 seed 从默认头像里稳定挑一张
 *   3. 图片加载失败    → 退回昵称首字（默认头像被删、网络挂了等情况）
 *
 * seed 传用户 id。用它而不是昵称，是为了改昵称时头像不跟着变。
 */
const props = withDefaults(
  defineProps<{
    src?: string
    name?: string
    size?: number
    /** 稳定选默认头像的种子，一般传用户 id */
    seed?: string
  }>(),
  { size: 40 }
)

const broken = ref(false)
/** 换了图（比如刚上传完）要把失败状态清掉，否则会一直显示首字 */
watch(
  () => props.src,
  () => {
    broken.value = false
  }
)

const resolved = computed(() => {
  if (props.src) return resolveFileUrl(props.src)
  return pickDefaultAvatar(props.seed || props.name)
})

const initial = computed(() => (props.name ? props.name.slice(0, 1) : '?'))
const px = computed(() => `${props.size}px`)
const fontSize = computed(() => `${Math.round(Number(props.size) * 0.38)}px`)
</script>

<template>
  <view class="avatar" :style="{ width: px, height: px, fontSize }">
    <image
      v-if="resolved && !broken"
      class="avatar__img"
      :src="resolved"
      mode="aspectFill"
      @error="broken = true"
    />
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
