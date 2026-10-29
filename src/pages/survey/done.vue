<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { onLoad, onShareAppMessage } from '@dcloudio/uni-app'
import type { Poll } from '@/types/api'
import AppIcon from '@/components/base/AppIcon.vue'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import { fetchPoll, fetchMyAnswers } from '@/api/poll'
import { buildShareMessage, syncShareMenu } from '@/utils/share'
import { bottomInset } from '@/utils/platform'
import { backTo, go, ROUTES } from '@/utils/router'

/**
 * 66 问卷 · 提交成功
 *
 * 13 的问卷版本，结构完全一致：
 *   成功图标 + 「你的回答」摘要 + 两个出口 + 3 秒自动返回。
 * 摘要里显示刚提交的那一条，超出两行截断——这里只是确认「收到了」，
 * 不是阅读界面，全文去详情页看。
 */
const poll = ref<Poll | null>(null)
const answerText = ref('')
const pollId = ref('')
const error = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

onLoad((q) => {
  pollId.value = (q?.id as string) ?? ''
})

async function load() {
  if (!pollId.value) return
  error.value = false
  try {
    const [p, answers] = await Promise.all([fetchPoll(pollId.value), fetchMyAnswers(pollId.value)])
    poll.value = p
    syncShareMenu(p.rules.allowShare)
    answerText.value = answers[0]?.content ?? ''

    timer = setTimeout(() => {
      backTo(ROUTES.detail, { id: pollId.value })
    }, 3000)
  } catch {
    // 和投票成功页一样：失败时给重试和返回，不能停在空白页
    error.value = true
  }
}

onMounted(load)

onUnmounted(() => {
  if (timer) clearTimeout(timer)
})

function viewMine() {
  if (timer) clearTimeout(timer)
  backTo(ROUTES.detail, { id: pollId.value })
}

/** 80 分享页：先停掉自动返回，否则 3 秒后会把分享页一起弹掉 */
function goShare() {
  if (timer) clearTimeout(timer)
  go(ROUTES.share, { id: pollId.value })
}

onShareAppMessage(() =>
  poll.value ? buildShareMessage(poll.value) : { title: '杜雅轩', path: '/pages/index/index' }
)
</script>

<template>
  <view class="done">
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

    <view v-else class="done__content" :style="{ paddingBottom: bottomInset(28) }">
      <!-- 和 71 投票成功页同一套入场：勾先弹出来，文字依次跟上 -->
      <view class="done__icon anim anim--success">
        <AppIcon name="check" :size="42" color="#FFFFFF" :stroke-width="2.4" />
      </view>

      <text class="done__title anim anim--fade-up anim--stagger-2">回答已提交</text>
      <text class="done__desc anim anim--fade-up anim--stagger-3">你的回答已记录，发起人可逐条查看</text>

      <view class="recap anim anim--fade-up anim--stagger-4">
        <text class="recap__label">你的回答</text>
        <view class="recap__row">
          <AppIcon name="message-square-text" :size="15" color="#4F46E5" />
          <text class="recap__text">{{ answerText || '（跳过未答）' }}</text>
        </view>
      </view>

      <view class="done__actions">
        <view class="done__primary" hover-class="done__primary--active" @tap="viewMine">
          <text class="done__primary-text">查看我的回答</text>
        </view>
        <view class="done__secondary" hover-class="done__secondary--active" @tap="goShare">
          <AppIcon name="share-2" :size="17" color="#09090B" />
          <text class="done__secondary-text">邀请同事一起填</text>
        </view>
      </view>

      <text class="done__note">3 秒后自动返回问卷详情</text>
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'SurveyDonePage' }
</script>

<style lang="scss" scoped>
.done {
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

  &__row {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }

  &__text {
    flex: 1;
    font-size: 14px;
    font-weight: 600;
    color: $ink;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }
}
</style>
