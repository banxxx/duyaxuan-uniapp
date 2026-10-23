<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/base/AppIcon.vue'
import { formatDate, formatRemaining } from '@/utils/format'
import type { PendingPoll } from '@/mock/data'

/**
 * 首页「待我投票」卡片（02）
 *
 * 和 41/42 的列表行不是一个东西：
 *   这里要让人一眼看出「谁邀请我、还剩多久、要不要现在去投」，
 *   所以是竖排大卡 + 右下角一颗「去投票」主按钮。
 *
 * 24 小时内截止的卡片描边换成 $warning，左上角徽标也换成警示底色——
 * 这是整页唯一的强提示，不再额外加红点。
 */
const props = defineProps<{ poll: PendingPoll }>()
const emit = defineEmits<{ (e: 'vote'): void; (e: 'tap'): void }>()

const DAY = 24 * 3600 * 1000
const urgent = computed(() => props.poll.endAt - Date.now() <= DAY)

const deadlineText = computed(() => {
  const left = props.poll.endAt - Date.now()
  if (left <= 0) return '已截止'
  if (left <= DAY) {
    const d = new Date(props.poll.endAt)
    return `今天 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 截止`
  }
  return `${formatDate(props.poll.endAt)}截止`
})

const metaText = computed(() => {
  const parts: string[] = []
  if (props.poll.anonymous) parts.push('匿名')
  parts.push(props.poll.type === 'multiple' ? '多选' : '单选')
  return parts.join(' · ')
})

/** 卡片底部：多选显示选择上限，单选显示剩余时间 */
const footText = computed(() =>
  props.poll.type === 'multiple' && props.poll.maxChoice
    ? `最多选 ${props.poll.maxChoice} 项`
    : formatRemaining(props.poll.endAt)
)

/** 设计稿里只有「剩余时间」这一种文案会跟着紧急态变橙色，「最多选 N 项」始终 $faint */
const footUrgent = computed(
  () => urgent.value && !(props.poll.type === 'multiple' && props.poll.maxChoice)
)
</script>

<template>
  <view class="pending" :class="{ 'pending--urgent': urgent }" @tap="emit('tap')">
    <view class="pending__top">
      <view class="pending__badge" :class="{ 'pending__badge--urgent': urgent }">
        <text class="pending__badge-text" :class="{ 'pending__badge-text--urgent': urgent }">
          {{ deadlineText }}
        </text>
      </view>
      <text class="pending__meta">{{ metaText }}</text>
    </view>

    <text class="pending__title">{{ poll.title }}</text>

    <view class="pending__inviter">
      <AppIcon name="user-round" :size="12" color="#A1A1AA" :stroke-width="2" />
      <text class="pending__inviter-text">
        {{ poll.inviterName }} 邀请你 · {{ poll.voterCount }} 人已投
      </text>
    </view>

    <view class="pending__foot">
      <text class="pending__left" :class="{ 'pending__left--urgent': footUrgent }">{{ footText }}</text>
      <view class="pending__btn" hover-class="pending__btn--active" @tap.stop="emit('vote')">
        <text class="pending__btn-text">去投票</text>
      </view>
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'PendingCard' }
</script>

<style lang="scss" scoped>
.pending {
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding: 16px;
  background: $surface;
  border: 1px solid $line;
  border-radius: 16px;

  &--urgent {
    border-color: #fde68a;
  }

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__badge {
    padding: 4px 9px;
    border-radius: 6px;
    background: $subtle;
    display: flex;
    align-items: center;

    &--urgent {
      background: $warning-soft;
    }
  }

  &__badge-text {
    font-size: 10px;
    font-weight: 600;
    color: $muted;

    &--urgent {
      color: $warning;
    }
  }

  &__meta {
    font-size: 10px;
    color: $faint;
  }

  &__title {
    font-size: 16px;
    font-weight: 600;
    color: $ink;
    line-height: 1.35;
  }

  &__inviter {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  &__inviter-text {
    font-size: 11px;
    color: $muted;
  }

  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__left {
    font-size: 11px;
    color: $faint;

    &--urgent {
      color: $warning;
    }
  }

  /* 设计稿 Vote Btn：$accent、圆角 10、padding [8,16]、字 12/600 */
  &__btn {
    padding: 8px 16px;
    border-radius: 10px;
    background: $accent;
    display: flex;
    align-items: center;

    &--active {
      opacity: 0.85;
    }
  }

  &__btn-text {
    font-size: 12px;
    font-weight: 600;
    color: #fff;
  }
}
</style>
