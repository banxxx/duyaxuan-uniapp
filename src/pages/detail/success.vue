<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { onLoad, onShareAppMessage } from '@dcloudio/uni-app'
import type { Poll } from '@/types/api'
import AppIcon from '@/components/base/AppIcon.vue'
import AppNavBar from '@/components/base/AppNavBar.vue'
import { fetchPoll, fetchMyVote } from '@/api/poll'
import { buildShareMessage } from '@/utils/share'
import { bottomInset } from '@/utils/platform'

/**
 * 13 投票成功
 *
 * 这是一个「中转页」，不是结果页：
 *   上面告诉你投给了什么，下面给两个出口（看状态 / 拉人）。
 * 3 秒后自动返回详情，所以按钮要够大够明显——用户来不及慢慢找。
 *
 * 结果不可见时，第一颗按钮的文案是「查看投票状态」而不是「查看结果」，
 * 点进去落在详情页，那里会显示「结果暂不可见」。这是设计稿的原文口径。
 */
const poll = ref<Poll | null>(null)
const myVote = ref<string[]>([])
const pollId = ref('')
let timer: ReturnType<typeof setTimeout> | null = null

const choices = ref<string[]>([])
const canSeeResult = ref(false)

onLoad((q) => {
  pollId.value = (q?.id as string) ?? ''
})

onMounted(async () => {
  if (!pollId.value) return
  const [p, mine] = await Promise.all([fetchPoll(pollId.value), fetchMyVote(pollId.value)])
  poll.value = p
  myVote.value = mine
  choices.value = p.options.filter((o) => mine.includes(o.id)).map((o) => o.title)

  const v = p.rules.resultVisibility ?? 'after_vote'
  canSeeResult.value = v === 'always' || v === 'after_vote'

  timer = setTimeout(() => {
    uni.redirectTo({ url: `/pages/detail/index?id=${pollId.value}` })
  }, 3000)
})

onUnmounted(() => {
  if (timer) clearTimeout(timer)
})

function viewStatus() {
  if (timer) clearTimeout(timer)
  uni.redirectTo({ url: `/pages/detail/index?id=${pollId.value}` })
}

onShareAppMessage(() => (poll.value ? buildShareMessage(poll.value) : { title: '投票吧', path: '/pages/index/index' }))
</script>

<template>
  <view class="success">
    <AppNavBar :back="false" />

    <view class="success__content" :style="{ paddingBottom: bottomInset(28) }">
      <view class="success__icon">
        <AppIcon name="check" :size="42" color="#FFFFFF" :stroke-width="2.4" />
      </view>

      <text class="success__title">投票成功</text>
      <text class="success__desc">
        {{ canSeeResult ? '你的选择已记录，可以去看看实时票数' : '你的选择已记录，发起人未开放实时结果' }}
      </text>

      <view class="recap">
        <text class="recap__label">你投给了</text>
        <view v-for="c in choices" :key="c" class="recap__choice">
          <AppIcon name="circle-check" :size="15" color="#4F46E5" />
          <text class="recap__choice-text">{{ c }}</text>
        </view>
        <view v-if="!choices.length" class="recap__choice">
          <text class="recap__choice-text">已记录</text>
        </view>
      </view>

      <view class="success__actions">
        <view class="success__primary" hover-class="success__primary--active" @tap="viewStatus">
          <text class="success__primary-text">{{ canSeeResult ? '查看投票结果' : '查看投票状态' }}</text>
        </view>
        <button class="success__secondary" hover-class="success__secondary--active" open-type="share">
          <AppIcon name="share-2" :size="17" color="#09090B" />
          <text class="success__secondary-text">邀请同事一起投</text>
        </button>
      </view>

      <text class="success__note">3 秒后自动返回投票详情</text>
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'VoteSuccessPage' }
</script>

<style lang="scss" scoped>
.success {
  min-height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  /* 设计稿 13/66：Content 竖向流 padding [80,24,28,24]、gap 24，所有块等距；
     下边距由 bottomInset(28) 内联控制 */
  &__content {
    flex: 1;
    padding: 80px 24px 28px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
  }

  &__icon {
    width: 88px;
    height: 88px;
    border-radius: 44px;
    background: $success;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__title {
    font-size: 26px;
    font-weight: 700;
    color: $ink;
  }

  &__desc {
    font-size: 13px;
    color: $muted;
    text-align: center;
  }

  &__actions {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  &__primary {
    height: 52px;
    border-radius: 16px;
    background: $ink;
    display: flex;
    align-items: center;
    justify-content: center;

    &--active {
      opacity: 0.86;
    }
  }

  &__primary-text {
    font-size: 15px;
    font-weight: 600;
    color: #fff;
  }

  &__secondary {
    height: 52px;
    border-radius: 16px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;

    &--active {
      background: $subtle;
    }
  }

  &__secondary-text {
    font-size: 15px;
    font-weight: 600;
    color: $ink;
  }

  &__note {
    font-size: 11px;
    color: $faint;
  }
}

.recap {
  width: 100%;
  padding: 16px;
  background: $surface;
  border: 1px solid $line;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__label {
    font-size: 11px;
    color: $faint;
  }

  &__choice {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__choice-text {
    font-size: 14px;
    font-weight: 600;
    color: $ink;
  }
}
</style>
