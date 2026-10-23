<script setup lang="ts">
import { computed } from 'vue'
import type { Poll } from '@/types/api'
import AppIcon from '@/components/base/AppIcon.vue'
import StatusPill from './StatusPill.vue'
import TypeBadge from './TypeBadge.vue'
import StatItem from './StatItem.vue'
import { formatDate, formatRemaining, percent } from '@/utils/format'

/**
 * 列表行 —— 41 我发起的 / 42 我参与的 / 04 搜索结果 共用
 *
 * 设计稿约定：
 *   Top    = 状态胶囊 + 类型标识 …… 右侧时间
 *   Title  = 14/600 单行省略
 *   Foot   = 指标（票/回答 + 评论）…… 右侧「···」或「›」
 * 指标随类型变：投票「89 票」，问卷「34 条」。
 *
 * 行尾图标：
 *   自己的列表（我发起的）→ ellipsis，点它出管理面板
 *   别人的列表（我参与的）→ chevron-right，纯浏览
 */
const props = withDefaults(
  defineProps<{
    poll: Poll
    /** 管理态：行尾显示「···」 */
    manage?: boolean
    /** 我参与的列表里显示「你投了…」 */
    showMyChoice?: boolean
    /** 搜索结果的紧凑形态 */
    compact?: boolean
  }>(),
  { manage: false, showMyChoice: false, compact: false }
)

const emit = defineEmits<{
  (e: 'tap', poll: Poll): void
  (e: 'more', poll: Poll): void
}>()

const isEnded = computed(() => props.poll.rules.endAt <= Date.now())
const status = computed(() => (isEnded.value ? 'ended' : 'ongoing'))
const dateText = computed(() =>
  isEnded.value ? formatDate(props.poll.rules.endAt) : formatRemaining(props.poll.rules.endAt)
)

const isSurvey = computed(() => props.poll.type === 'survey')

/**
 * 42 的状态胶囊说的不是「这场投票怎样」，而是「我和它怎样」：
 *   已结束 → 已结束（灰）
 *   问卷进行中 → 收集中（绿）
 *   我投过 → 已投票（紫）
 *   其余 → 进行中（绿）
 */
const statusLabel = computed(() => {
  if (!props.showMyChoice) return undefined
  if (isEnded.value) return '已结束'
  if (isSurvey.value) return '收集中'
  if (props.poll.myChoice || props.poll.myChoiceCount) return '已投票'
  return '进行中'
})

const statusTone = computed(() => {
  if (!props.showMyChoice) return undefined
  if (isEnded.value) return 'ended'
  if (!isSurvey.value && (props.poll.myChoice || props.poll.myChoiceCount)) return 'accent'
  return 'ongoing'
})

const countText = computed(() => {
  if (isSurvey.value) return `${props.poll.answerCount ?? 0} 条`
  // 多选时显示参与人数而不是总票数，和设计稿口径一致
  return `${props.poll.voterCount} 票`
})

/** 问卷没有「投了哪项」，有回答就显示「已回答」；投票按单选/多选给不同措辞 */
const myChoice = computed(() => {
  if (isSurvey.value) return props.poll.answerCount ? '已回答 · 可修改' : ''
  if (props.poll.myChoiceCount) return `你投了 ${props.poll.myChoiceCount} 项`
  return props.poll.myChoice ? `你投了：${props.poll.myChoice}` : ''
})

function onTap() {
  emit('tap', props.poll)
}

function onMore(e: Event) {
  // 阻止冒泡到整行，否则会同时进详情
  e.stopPropagation?.()
  emit('more', props.poll)
}
</script>

<template>
  <view
    class="poll-row"
    :class="{ 'poll-row--compact': compact }"
    hover-class="poll-row--active"
    @tap.stop="onTap"
  >
    <view class="poll-row__top">
      <view class="poll-row__left">
        <StatusPill :status="status" :label="statusLabel" :tone="statusTone" />
        <TypeBadge :type="poll.type" :size="compact ? 'sm' : 'md'" />
      </view>
      <text class="poll-row__date">{{ dateText }}</text>
    </view>

    <text class="poll-row__title">{{ poll.title }}</text>

    <view class="poll-row__foot">
      <view class="poll-row__stats">
        <StatItem :icon="isSurvey ? 'message-square-text' : 'users'" :value="countText" />
        <StatItem icon="message-square" :value="poll.commentCount" />
      </view>
      <view class="poll-row__more" @tap.stop="onMore">
        <AppIcon
          :name="manage ? 'ellipsis' : 'chevron-right'"
          :size="manage ? 15 : 15"
          color="#A1A1AA"
          :stroke-width="2"
        />
      </view>
    </view>

    <view v-if="showMyChoice && myChoice" class="poll-row__mine">
      <text class="poll-row__mine-text">{{ myChoice }}</text>
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'PollRow' }
</script>

<style lang="scss" scoped>
.poll-row {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 15px;
  background: $surface;
  border: 1px solid $line;
  border-radius: 14px;

  &--active {
    background: $subtle;
  }

  &--compact {
    gap: 7px;
    padding: 12px;
    border-radius: 12px;
  }

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__left {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  &__date {
    font-size: 10px;
    color: $faint;
    flex-shrink: 0;
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    color: $ink;
    line-height: 1.4;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__stats {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  &__more {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: -4px;
  }

  /* 设计稿 My Choice / My Answer：$accent-soft、圆角 6、padding [4,9]、字 10/600 $accent */
  &__mine {
    align-self: flex-start;
    padding: 4px 9px;
    border-radius: 6px;
    background: $accent-soft;
  }

  &__mine-text {
    font-size: 10px;
    font-weight: 600;
    color: $accent;
  }
}
</style>
