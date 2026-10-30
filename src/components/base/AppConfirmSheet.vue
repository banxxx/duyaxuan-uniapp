<script setup lang="ts">
import AppSheet from './AppSheet.vue'
import AppButton from './AppButton.vue'

/**
 * 底部二次确认面板（49/56/57/92/95 同一套）
 *
 * 原生 uni.showModal 的圆角、按钮排布、间距都改不了，
 * 放在底部弹层里会显得很突兀。这里统一成 AppSheet 的 confirm 形态：
 * 上沿 24 圆角、标题 17/700、两个 50 高按钮。
 */
withDefaults(
  defineProps<{
    visible: boolean
    title: string
    desc?: string
    confirmText?: string
    cancelText?: string
    /** 删除类操作用红底 */
    danger?: boolean
    loading?: boolean
  }>(),
  { confirmText: '确定', cancelText: '取消', danger: false, loading: false }
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirm'): void
}>()
</script>

<template>
  <AppSheet :visible="visible" variant="confirm" :title="title" :desc="desc" @close="emit('close')">
    <view class="confirm-actions">
      <view class="confirm-actions__btn">
        <AppButton type="subtle" size="dialog" @tap="emit('close')">{{ cancelText }}</AppButton>
      </view>
      <view class="confirm-actions__btn">
        <AppButton
          :type="danger ? 'danger' : 'primary'"
          size="dialog"
          :loading="loading"
          @tap="emit('confirm')"
        >
          {{ confirmText }}
        </AppButton>
      </view>
    </view>
  </AppSheet>
</template>

<script lang="ts">
export default { name: 'AppConfirmSheet' }
</script>

<style lang="scss" scoped>
.confirm-actions {
  display: flex;
  align-items: center;
  gap: 10px;

  &__btn {
    flex: 1;
  }
}
</style>
