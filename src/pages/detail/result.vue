<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onLoad, onShareAppMessage } from '@dcloudio/uni-app'
import type { Poll } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import { fetchPoll, fetchMyVote, remindMe } from '@/api/poll'
import { formatDate, formatDateTime, formatRelative, percent } from '@/utils/format'
import { buildShareMessage } from '@/utils/share'
import { bottomInset } from '@/utils/platform'
import { backTo, go, ROUTES } from '@/utils/router'

/**
 * 21 结果 · 实时统计 / 22 结果 · 待公布 / 23 结果 · 已关闭
 *
 * 三种形态由 resultVisibility + 是否已结束决定，共用同一页：
 *   可见   → 冠军卡 + 排名列表 + 三个指标
 *   待公布 → 倒计时 + 你投给了什么 + 「截止时提醒我」
 *   已关闭 → 说明文案 + 你投给了什么，不给任何票数
 *
 * 「投票记录」和 14/15 是两件事：这里是票数聚合，那里是逐票流水，
 * 所以排名行右侧只放一个跳转链接，不在这里展开明细。
 */
const poll = ref<Poll | null>(null)
const myVote = ref<string[]>([])
const loading = ref(true)
const reminded = ref(false)
const pollId = ref('')

const isEnded = computed(() => !!poll.value && poll.value.rules.endAt <= Date.now())

type Mode = 'visible' | 'pending' | 'closed'
const mode = computed<Mode>(() => {
  const p = poll.value
  if (!p) return 'closed'
  const v = p.rules.resultVisibility ?? 'after_vote'
  if (v === 'hidden') return 'closed'
  if (v === 'after_end') return isEnded.value ? 'visible' : 'pending'
  return 'visible'
})

const totalVotes = computed(() => poll.value?.options.reduce((s, o) => s + o.votes, 0) ?? 0)

/** 排名：票数降序，同票保持原顺序 */
const ranked = computed(() => {
  const opts = [...(poll.value?.options ?? [])]
  return opts
    .map((o, i) => ({ ...o, pct: percent(o.votes, totalVotes.value), origin: i }))
    .sort((a, b) => b.votes - a.votes || a.origin - b.origin)
})

const winner = computed(() => ranked.value[0])

const myChoices = computed(() =>
  (poll.value?.options ?? []).filter((o) => myVote.value.includes(o.id))
)

/** 22 的倒计时 */
const countdown = computed(() => {
  if (!poll.value) return ''
  const diff = poll.value.rules.endAt - Date.now()
  if (diff <= 0) return '已结束'
  const d = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  return d > 0 ? `${d} 天${h > 0 ? ` ${h} 小时` : ''}` : `${h} 小时`
})

/**
 * 22 的进度条：这段时间还剩多少。
 * 没有单独的创建时间可用，就按「距截止 / 7 天」估——超过 7 天的一律满格，
 * 它只是给倒计时配一条视觉刻度，不承载精确信息。
 */
const timePct = computed(() => {
  if (!poll.value) return 0
  const left = poll.value.rules.endAt - Date.now()
  const window = 7 * 86400000
  return Math.min(100, Math.max(0, Math.round((left / window) * 100)))
})

async function load() {
  loading.value = true
  try {
    const p = await fetchPoll(pollId.value)
    poll.value = p
    if (p.type !== 'survey') myVote.value = await fetchMyVote(p.id)
  } finally {
    loading.value = false
  }
}

onLoad((q) => {
  pollId.value = (q?.id as string) ?? ''
})
onMounted(load)

async function onRemind() {
  if (!poll.value) return
  await remindMe(poll.value.id)
  reminded.value = true
  uni.showToast({ title: '已设置，截止时提醒你', icon: 'none' })
}

function goVoters() {
  go(ROUTES.detailVoters, { id: pollId.value })
}

function backToDetail() {
  backTo(ROUTES.detail, { id: pollId.value })
}

onShareAppMessage(() => (poll.value ? buildShareMessage(poll.value) : { title: '投票吧', path: '/pages/index/index' }))
</script>

<template>
  <view class="result">
    <AppNavBar title="投票结果">
      <template #right>
        <!-- 结果页右上角不再放分享图标：微信胶囊里就有转发，图标只会弹 toast -->
      </template>
    </AppNavBar>

    <view v-if="loading" class="result__body">
      <AppSkeleton type="stats" />
    </view>

    <scroll-view v-else-if="poll" class="result__scroll" scroll-y>
      <view class="result__content">
        <!-- ================= 21 可见 ================= -->
        <template v-if="mode === 'visible'">
          <view class="hero">
            <view class="hero__top">
              <view class="hero__badge">
                <view class="hero__dot" />
                <text class="hero__badge-text">{{ isEnded ? '最终结果' : '实时更新' }}</text>
              </view>
              <text class="hero__total">
                {{ totalVotes }} 票 · {{ poll.type === 'multiple' ? '多选' : '单选' }}
              </text>
            </view>

            <text class="hero__title">{{ poll.title }}</text>

            <view v-if="winner" class="hero__winner">
              <view class="hero__winner-row">
                <view class="hero__winner-left">
                  <view class="hero__winner-label-row">
                    <AppIcon name="crown" :size="11" color="#4F46E5" />
                    <text class="hero__winner-label">领先</text>
                  </view>
                  <text class="hero__winner-name">{{ winner.title }}</text>
                </view>
                <text class="hero__winner-pct">{{ winner.pct }}%</text>
              </view>
              <view class="hero__track">
                <view class="hero__fill" :style="{ width: `${winner.pct}%` }" />
              </view>
            </view>
          </view>

          <view class="rank">
            <view class="rank__head">
              <text class="rank__title">各选项得票</text>
              <view class="rank__link" @tap="goVoters">
                <text class="rank__link-text">投票记录</text>
                <AppIcon name="chevron-right" :size="12" color="#A1A1AA" />
              </view>
            </view>

            <view v-for="(opt, i) in ranked" :key="opt.id" class="rank__row">
              <view class="rank__row-top">
                <view class="rank__left">
                  <view class="rank__badge" :class="{ 'rank__badge--first': i === 0 }">
                    <text class="rank__badge-text" :class="{ 'rank__badge-text--first': i === 0 }">
                      {{ i + 1 }}
                    </text>
                  </view>
                  <text class="rank__name" :class="{ 'rank__name--first': i === 0 }">{{ opt.title }}</text>
                </view>
                <view class="rank__right">
                  <text class="rank__votes">{{ opt.votes }} 票</text>
                  <text class="rank__pct" :class="{ 'rank__pct--first': i === 0 }">{{ opt.pct }}%</text>
                </view>
              </view>
              <view class="rank__track">
                <view
                  class="rank__fill"
                  :class="{ 'rank__fill--first': i === 0 }"
                  :style="{ width: `${opt.pct}%` }"
                />
              </view>
            </view>
          </view>

          <view class="stats">
            <view class="stats__item">
              <text class="stats__label">参与人数</text>
              <text class="stats__value">{{ poll.voterCount }}</text>
            </view>
            <view class="stats__item">
              <text class="stats__label">最近投票</text>
              <text class="stats__value">{{ formatRelative(Date.now() - 2 * 60 * 1000) }}</text>
            </view>
            <view class="stats__item">
              <text class="stats__label">{{ isEnded ? '截止时间' : '截止时间' }}</text>
              <text class="stats__value stats__value--date">{{ formatDate(poll.rules.endAt) }}</text>
            </view>
          </view>
        </template>

        <!-- ================= 22 待公布 ================= -->
        <template v-else-if="mode === 'pending'">
          <view class="state">
            <view class="state__icon">
              <AppIcon name="lock" :size="28" color="#A1A1AA" />
            </view>
            <text class="state__title">结果将在投票结束后公布</text>
            <text class="state__desc">发起人设置了截止后公布，避免提前看到票数影响判断</text>
          </view>

          <view class="countdown">
            <view class="countdown__row">
              <text class="countdown__label">距截止</text>
              <text class="countdown__date">{{ formatDateTime(poll.rules.endAt) }}</text>
            </view>
            <text class="countdown__value">{{ countdown }}</text>
            <view class="countdown__track">
              <view class="countdown__fill" :style="{ width: `${timePct}%` }" />
            </view>
          </view>

          <view v-if="myChoices.length" class="mine">
            <text class="mine__label">你投给了</text>
            <view v-for="o in myChoices" :key="o.id" class="mine__choice">
              <AppIcon name="circle-check" :size="15" color="#4F46E5" />
              <text class="mine__choice-text">{{ o.title }}</text>
            </view>
          </view>

          <!-- 22 的两个动作：白底提醒 + 黑底返回（黑底比主色更「退出」，不与主操作抢视线） -->
          <view class="state__actions">
            <AppButton type="subtle" size="cta" :radius="14" icon="bell" class="state__action" @tap="onRemind">
              {{ reminded ? '已设置截止提醒' : '截止时提醒我' }}
            </AppButton>
            <AppButton type="ink" size="cta" :radius="14" class="state__action" @tap="backToDetail">
              返回投票详情
            </AppButton>
          </view>
        </template>

        <!-- ================= 23 已关闭 ================= -->
        <template v-else>
          <view class="state">
            <view class="state__icon">
              <AppIcon name="lock" :size="28" color="#A1A1AA" />
            </view>
            <text class="state__title">发起人已关闭结果查看</text>
            <text class="state__desc">这场投票不公开票数，投票结束后也不会公布</text>
          </view>

          <view v-if="myChoices.length" class="mine">
            <text class="mine__label">你投给了</text>
            <view v-for="o in myChoices" :key="o.id" class="mine__choice">
              <AppIcon name="circle-check" :size="15" color="#4F46E5" />
              <text class="mine__choice-text">{{ o.title }}</text>
            </view>
          </view>

          <text class="closed__note">如需查看结果，请联系发起人</text>

          <view class="state__actions">
            <AppButton type="ink" size="cta" :radius="14" @tap="backToDetail">返回投票详情</AppButton>
          </view>
        </template>
      </view>
    </scroll-view>

    <!-- 21 底部只有一个「分享给同事」，open-type=share 直接拉起分享面板 -->
    <view v-if="poll && mode === 'visible'" class="result__actions" :style="{ paddingBottom: bottomInset(20) }">
      <AppButton type="subtle" size="cta" icon="link" open-type="share">分享给同事</AppButton>
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'PollResultPage' }
</script>

<style lang="scss" scoped>
.result {
  min-height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  &__nav-btn {
    width: 34px;
    height: 34px;
    border-radius: 17px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__body {
    flex: 1;
  }

  &__scroll {
    flex: 1;
    height: 0;
  }

  /* 21/22/23：Content 竖向流 gap 14、padding [4,20,20,20]；底部操作栏自处理安全区 */
  &__content {
    padding: 4px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* 21 底部只有一个白底分享按钮：上 8、左右 20，下边距由 bottomInset() 控制 */
  &__actions {
    padding: 8px $gutter 0;
    flex-shrink: 0;
  }
}

/* 冠军卡：$ink 实底、圆角 20、内边距 20、行距 14 */
.hero {
  padding: 20px;
  border-radius: 20px;
  background: $ink;
  display: flex;
  flex-direction: column;
  gap: 14px;

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  /* 徽标是白色 10% 底，不是 $accent：紫在这个黑底上会糊 */
  &__badge {
    padding: 5px 10px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.1);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  &__dot {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: #047857;
  }

  &__badge-text {
    font-size: 11px;
    font-weight: 500;
    color: #fff;
  }

  &__total {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
  }

  &__title {
    font-size: 19px;
    font-weight: 700;
    color: #fff;
    line-height: 1.35;
  }

  &__winner {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  &__winner-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
  }

  &__winner-left {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  /* 21：「领先」前面挂一枚小皇冠，跟 46% 的紫字呼应 */
  &__winner-label-row {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  &__winner-label {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.5);
  }

  &__winner-name {
    font-size: 15px;
    font-weight: 600;
    color: #fff;
  }

  &__winner-pct {
    font-size: 30px;
    font-weight: 700;
    color: $accent;
    font-family: $font-num;
    line-height: 1;
  }

  &__track {
    height: 8px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }

  &__fill {
    height: 100%;
    border-radius: 4px;
    background: $accent;
    transition: width 0.5s ease;
  }
}

/* 排名卡 */
.rank {
  padding: 16px;
  background: $surface;
  border: 1px solid $line;
  border-radius: 18px;
  display: flex;
  flex-direction: column;
  gap: 13px;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    color: $ink;
  }

  &__link {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  &__link-text {
    font-size: 11px;
    color: $muted;
  }

  &__row {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__row-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  &__badge {
    width: 18px;
    height: 18px;
    border-radius: 6px;
    background: $bg;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;

    &--first {
      background: $accent;
    }
  }

  &__badge-text {
    font-size: 10px;
    font-weight: 600;
    color: $faint;

    &--first {
      color: #fff;
    }
  }

  &__name {
    font-size: 13px;
    font-weight: 500;
    color: $ink;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;

    &--first {
      font-weight: 600;
    }
  }

  &__right {
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-shrink: 0;
    padding-left: 8px;
  }

  &__votes {
    font-size: 12px;
    color: $muted;
    font-family: $font-num;
  }

  &__pct {
    font-size: 13px;
    font-weight: 600;
    color: $ink;
    font-family: $font-num;

    &--first {
      color: $accent;
    }
  }

  &__track {
    height: 8px;
    border-radius: 4px;
    background: $bg;
    overflow: hidden;
  }

  &__fill {
    height: 100%;
    border-radius: 4px;
    background: #d4d4d8;

    &--first {
      background: $accent;
    }
  }
}

/* 三个指标 */
.stats {
  display: flex;
  gap: 10px;

  &__item {
    flex: 1;
    padding: 14px;
    background: $surface;
    border: 1px solid $line;
    border-radius: 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__label {
    font-size: 10px;
    color: $faint;
  }

  /* 21 的三个指标：三列等宽、单行显示，值 18/700；日期过长时缩到 15 号 */
  &__value {
    font-size: 18px;
    font-weight: 700;
    color: $ink;
    font-family: $font-num;
    line-height: 1.2;

    &--date {
      font-size: 15px;
      line-height: 1.44;
    }
  }
}

/* 22/23 状态块：白卡、圆角 20、内边距 [32,24]，图标 64 圆底、标题居中 */
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 24px;
  background: $surface;
  border: 1px solid $line;
  border-radius: 20px;
  gap: 12px;

  &__icon {
    width: 64px;
    height: 64px;
    border-radius: 32px;
    background: $subtle;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__title {
    font-size: 17px;
    font-weight: 600;
    color: $ink;
    text-align: center;
  }

  &__desc {
    font-size: 12px;
    color: $muted;
    text-align: center;
    line-height: 1.6;
  }

  &__actions {
    display: flex;
    gap: 10px;
  }

  &__action {
    flex: 1;
  }
}

/* 22 倒计时：黑底卡、白色文字、进度条 $accent */
.countdown {
  padding: 16px;
  background: $ink;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__label {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.6);
  }

  &__date {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
  }

  &__value {
    font-size: 26px;
    font-weight: 700;
    color: #fff;
    font-family: $font-num;
  }

  &__track {
    height: 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }

  &__fill {
    height: 100%;
    border-radius: 3px;
    background: $accent;
  }
}

/* 你投给了：白卡、圆角 16、内边距 16、行距 9 */
.mine {
  padding: 16px;
  background: $surface;
  border: 1px solid $line;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  gap: 9px;

  &__label {
    font-size: 11px;
    color: $faint;
  }

  &__choice {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* 22/23 的选项名是 14/400，不是加粗 */
  &__choice-text {
    font-size: 14px;
    font-weight: 400;
    color: $ink;
  }
}

.closed__note {
  font-size: 11px;
  color: $faint;
  text-align: center;
  padding: 0 0 4px;
}
</style>
