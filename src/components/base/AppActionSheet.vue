<script setup lang="ts">
import AppSheet from './AppSheet.vue'
import AppIcon from './AppIcon.vue'

/**
 * 通用底部操作菜单
 *
 * 之前各页面的「···」和长按菜单用的是 uni.showActionSheet，
 * 那是微信系统弹窗：圆角、遮罩、字号、分隔线都改不了，和 AppSheet 的
 * 其他弹层放在一起明显不是一个东西。这里把它收成一个组件，
 * 版式沿用 89「更多操作」：$subtle 分组、52 高行、底部独立取消按钮。
 */
withDefaults(
  defineProps<{
    visible: boolean
    items: Array<{
      key: string
      label: string
      desc?: string
      /** AppIcon 名称，省略则不显示图标 */
      icon?: string
      danger?: boolean
      disabled?: boolean
      /** 当前选中项，右侧显示对勾（筛选用） */
      selected?: boolean
    }>
    title?: string
    desc?: string
    cancelText?: string
  }>(),
  { cancelText: '取消' }
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', key: string): void
}>()

function pick(item: { key: string; disabled?: boolean }) {
  if (item.disabled) return
  emit('select', item.key)
  emit('close')
}
</script>

<template>
  <AppSheet :visible="visible" :title="title" :desc="desc" @close="emit('close')">
    <view class="actions">
      <view v-for="(item, i) in items" :key="item.key">
        <view v-if="i > 0" class="actions__sep" />
        <view
          class="actions__item"
          :class="{ 'actions__item--disabled': item.disabled }"
          :hover-class="item.disabled ? 'none' : 'actions__item--active'"
          @tap="pick(item)"
        >
          <AppIcon
            v-if="item.icon"
            :name="item.icon"
            :size="18"
            :color="item.danger ? '#DC2626' : '#09090B'"
          />
          <view class="actions__text">
            <text class="actions__label" :class="{ 'actions__label--danger': item.danger }">
              {{ item.label }}
            </text>
            <text v-if="item.desc" class="actions__desc">{{ item.desc }}</text>
          </view>
          <AppIcon v-if="item.selected" name="circle-check" :size="16" color="#4F46E5" :stroke-width="2" />
        </view>
      </view>
    </view>

    <template #footer>
      <view class="actions__cancel" hover-class="actions__item--active" @tap="emit('close')">
        <text class="actions__cancel-text">{{ cancelText }}</text>
      </view>
    </template>
  </AppSheet>
</template>

<script lang="ts">
export default { name: 'AppActionSheet' }
</script>

<style lang="scss" scoped>
.actions {
  background: $subtle;
  border-radius: 14px;
  overflow: hidden;

  &__item {
    min-height: 52px;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 12px;

    &--active {
      background: $line;
    }

    &--disabled {
      opacity: 0.35;
    }
  }

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__label {
    font-size: 14px;
    color: $ink;

    &--danger {
      color: $danger;
    }
  }

  &__desc {
    font-size: 11px;
    color: $faint;
    line-height: 1.45;
  }

  &__sep {
    height: 1px;
    background: $line;
    margin-left: 16px;
  }

  &__cancel {
    height: 50px;
    border-radius: 14px;
    background: $subtle;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__cancel-text {
    font-size: 15px;
    font-weight: 600;
    color: $ink;
  }
}
</style>
