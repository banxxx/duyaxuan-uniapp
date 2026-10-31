<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { onLoad, onShareAppMessage } from '@dcloudio/uni-app'
import type { Poll } from '@/types/api'
import AppIcon from '@/components/base/AppIcon.vue'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import { fetchPoll, fetchMyVote } from '@/api/poll'
import { buildShareMessage, syncShareMenu } from '@/utils/share'
import { canSeePollResult } from '@/utils/result-visibility'
import { bottomInset } from '@/utils/platform'
import { backTo, go, ROUTES } from '@/utils/router'
import AppToast from '@/components/base/AppToast.vue'

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
const error = ref(false)

onLoad((q) => {
  pollId.value = (q?.id as string) ?? ''
})

async function load() {
  if (!pollId.value) return
  error.value = false
  try {
    const [p, mine] = await Promise.all([fetchPoll(pollId.value), fetchMyVote(pollId.value)])
    poll.value = p
    syncShareMenu(p.rules.allowShare)
    myVote.value = mine
    choices.value = p.options.filter((o) => mine.includes(o.id)).map((o) => o.title)

    // 刚到这一页时已经投过票，hasVoted 恒为 true；结果可见性交给统一规则判断
    canSeeResult.value = canSeePollResult(p, {
      hasVoted: true,
      isEnded: p.rules.endAt <= Date.now()
    })

    timer = setTimeout(() => {
      backTo(ROUTES.detail, { id: pollId.value })
    }, 3000)
  } catch {
    // 加载失败时不能停在空白页：给重试和返回，用户至少能退出去
    error.value = true
  }
}

onMounted(load)

onUnmounted(() => {
  if (timer) clearTimeout(timer)
})

function viewStatus() {
  if (timer) clearTimeout(timer)
  backTo(ROUTES.detail, { id: pollId.value })
}

/** 27 分享页：先停掉自动返回，否则 3 秒后会把分享页一起弹掉 */
function goShare() {
  if (timer) clearTimeout(timer)
  go(ROUTES.share, { id: pollId.value })
}

onShareAppMessage(() => (poll.value ? buildShareMessage(poll.value) : { title: '杜雅轩', path: '/pages/index/index' }))
</script>

<template>
  <view class="success">
    <AppToast />
    <AppNavBar :back="error" />

    <AppEmpty
      v-if="error"
      icon="wifi-off"
      title="加载失败"
      desc="网络不太稳定，重试一下就好"
      action="重新加载"
      action-icon="refresh-cw"
      @action="load"
    />

    <view v-else class="success__content" :style="{ paddingBottom: bottomInset(28) }">
      <view class="success__icon anim anim--success">
        <AppIcon name="check" :size="42" color="#FFFFFF" :stroke-width="2.4" />
      </view>

      <text class="success__title anim anim--fade-up anim--stagger-2">投票成功</text>
      <text class="success__desc anim anim--fade-up anim--stagger-3">
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
        <view
          v-if="poll?.rules.allowShare"
          class="success__secondary"
          hover-class="success__secondary--active"
          @tap="goShare"
        >
          <AppIcon name="share-2" :size="17" color="#09090B" />
          <text class="success__secondary-text">邀请朋友一起投</text>
        </view>
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
  /* #ifdef H5 */
  min-height: 100dvh;
  /* #endif */
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
    border-radius: $r-circle;
    background: $success;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__title {
    font-size: $fs-26;
    font-weight: 700;
    color: $ink;
  }

  &__desc {
    font-size: $fs-13;
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
    border-radius: $r-button;
    background: $ink;
    display: flex;
    align-items: center;
    justify-content: center;

    &--active {
      opacity: 0.86;
    }
  }

  &__primary-text {
    font-size: $fs-15;
    font-weight: 600;
    color: $white;
  }

  &__secondary {
    height: 52px;
    border-radius: $r-button;
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
    font-size: $fs-15;
    font-weight: 600;
    color: $ink;
  }

  &__note {
    font-size: $fs-11;
    color: $faint;
  }
}

.recap {
  width: 100%;
  padding: 16px;
  background: $surface;
  border: 1px solid $line;
  border-radius: $r-button;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__label {
    font-size: $fs-11;
    color: $faint;
  }

  &__choice {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__choice-text {
    font-size: $fs-14;
    font-weight: 600;
    color: $ink;
  }
}
</style>
