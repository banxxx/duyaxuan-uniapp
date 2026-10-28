<script setup lang="ts">
import { ref, computed } from 'vue'
import AppIcon from '@/components/base/AppIcon.vue'

/**
 * 左滑露出操作（88 我发起的 · 左滑操作）
 *
 * 设计稿：行左移 152，右侧露出两个 76 宽的操作块——编辑（$subtle）、删除（$danger）。
 * 用 touch 事件手写，不引第三方：小程序里 60fps 的 transform 就够顺，
 * 而且避免组件库在抖音端的兼容问题。
 */
const ACTION_WIDTH = 152
const THRESHOLD = 60

const props = withDefaults(
  defineProps<{
    /** 是否允许删除（无权限时只显示编辑） */
    canDelete?: boolean
  }>(),
  { canDelete: true }
)

const emit = defineEmits<{
  (e: 'edit'): void
  (e: 'delete'): void
  (e: 'tap'): void
}>()

const offset = ref(0)
const dragging = ref(false)
let startX = 0
let startOffset = 0
let moved = false

const actionWidth = computed(() => (props.canDelete ? ACTION_WIDTH : 76))
const maxOffset = computed(() => -actionWidth.value)

const rowStyle = computed(() => ({
  transform: `translateX(${offset.value}px)`,
  transition: dragging.value ? 'none' : 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)'
}))

function onTouchStart(e: TouchEvent) {
  startX = e.touches[0].clientX
  startOffset = offset.value
  dragging.value = true
  moved = false
}

function onTouchMove(e: TouchEvent) {
  if (!dragging.value) return
  const dx = e.touches[0].clientX - startX
  if (Math.abs(dx) > 6) moved = true
  // 只允许向左拉，且不超过操作块总宽
  const next = Math.min(0, Math.max(maxOffset.value, startOffset + dx))
  offset.value = next
}

function onTouchEnd() {
  dragging.value = false
  // 拉过一半就吸附展开
  offset.value = offset.value < maxOffset.value / 2 ? maxOffset.value : 0
}

/** 点击时如果正在展开，先收起，不触发进入详情 */
function guardTap(cb: () => void) {
  if (offset.value !== 0) {
    offset.value = 0
    return
  }
  if (moved) return
  cb()
}

defineExpose({ close: () => (offset.value = 0) })
</script>

<template>
  <view class="swipe">
    <view class="swipe__actions" :style="{ width: `${actionWidth}px` }">
      <view class="swipe__action swipe__action--edit" hover-class="is-pressed" @tap="emit('edit')">
        <AppIcon name="square-pen" :size="18" color="#09090B" />
        <text class="swipe__label">编辑</text>
      </view>
      <view v-if="canDelete" class="swipe__action swipe__action--delete" hover-class="is-pressed" @tap="emit('delete')">
        <AppIcon name="trash-2" :size="18" color="#FFFFFF" />
        <text class="swipe__label swipe__label--light">删除</text>
      </view>
    </view>

    <view
      class="swipe__content"
      :style="rowStyle"
      @touchstart="onTouchStart"
      @touchmove.stop.prevent="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
      @tap.stop="guardTap(() => emit('tap'))"
    >
      <slot />
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'SwipeRow' }
</script>

<style lang="scss" scoped>
.swipe {
  position: relative;
  overflow: hidden;
  border-radius: 14px;

  &__actions {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
  }

  &__action {
    width: 76px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 7px;

    &--edit {
      background: $subtle;
    }

    &--delete {
      background: $danger;
    }
  }

  &__label {
    font-size: 11px;
    font-weight: 600;
    color: $ink;

    &--light {
      color: #fff;
    }
  }

  &__content {
    position: relative;
    z-index: 1;
    background: $surface;
    border-radius: 14px;
    will-change: transform;
  }
}
</style>
