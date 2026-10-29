<script setup lang="ts">
import AppIcon from './AppIcon.vue'

/**
 * 空状态 / 加载中 / 网络错误 三合一
 * 对应 59 / 60 / 61 三屏
 *
 * 设计稿（59/61）：88×88 圆角 24 的 $subtle 底图标块 + 图标 38，
 * 标题 18/bold，说明 13/$muted 宽 260 居中，主按钮 $accent 实底、[12,22]、圆角 12、字 14/600。
 */
withDefaults(
  defineProps<{
    icon?: string
    title: string
    desc?: string
    /** 有值就显示按钮 */
    action?: string
    /** 按钮左侧图标（59 是 plus，61 是 refresh-cw），不传就只有文字 */
    actionIcon?: string
    /** 是否显示 loading 动画（60 加载状态） */
    loading?: boolean
  }>(),
  { icon: 'inbox', loading: false }
)

const emit = defineEmits<{ (e: 'action'): void }>()
</script>

<template>
  <view class="empty anim anim--fade-up">
    <view class="empty__icon">
      <view v-if="loading" class="empty__spinner" />
      <AppIcon v-else :name="icon" :size="38" color="#A1A1AA" :stroke-width="1.5" />
    </view>
    <text class="empty__title">{{ title }}</text>
    <text v-if="desc" class="empty__desc">{{ desc }}</text>
    <view v-if="action" class="empty__action" hover-class="empty__action--active" @tap="emit('action')">
      <AppIcon v-if="actionIcon" :name="actionIcon" :size="16" color="#FFFFFF" :stroke-width="2" />
      <text class="empty__action-text">{{ action }}</text>
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'AppEmpty' }
</script>

<style lang="scss" scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80px 32px 32px;

  &__icon {
    width: 88px;
    height: 88px;
    border-radius: 24px;
    background: $subtle;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
  }

  &__spinner {
    width: 24px;
    height: 24px;
    border: 2px solid $line;
    border-top-color: $accent;
    border-radius: 50%;
    animation: empty-spin 0.8s linear infinite;
  }

  &__title {
    font-size: 18px;
    font-weight: 700;
    color: $ink;
  }

  &__desc {
    width: 260px;
    margin-top: 10px;
    font-size: 13px;
    color: $muted;
    text-align: center;
    line-height: 1.6;
  }

  &__action {
    margin-top: 20px;
    height: 42px;
    padding: 0 22px;
    border-radius: 12px;
    background: $accent;
    display: flex;
    align-items: center;
    gap: 7px;
    transition:
      opacity $dur-fast $ease-both,
      transform $dur-fast $ease-both;

    &--active {
      opacity: 0.85;
      transform: scale(0.97);
    }
  }

  &__action-text {
    font-size: 14px;
    font-weight: 600;
    color: #fff;
  }
}

@keyframes empty-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
