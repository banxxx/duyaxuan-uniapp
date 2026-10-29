<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onLoad, onPullDownRefresh, onShareAppMessage } from '@dcloudio/uni-app'
import type { Poll } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSheet from '@/components/base/AppSheet.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import { fetchPoll, fetchPollStats, endPoll } from '@/api/poll'
import { formatDate, formatDateTime, formatRelative, formatRemaining, percent } from '@/utils/format'
import { buildShareMessage, syncShareMenu } from '@/utils/share'
import { bottomInset } from '@/utils/platform'
import { ROUTES, go } from '@/utils/router'

/**
 * 24 发布者 · 数据 · 进行中 / 25 发布者 · 数据 · 已结束
 *
 * 一页两态，由 poll.rules.endAt 与当前时间比较得出。
 * 两态的卡片构成不同：24 是「趋势 + 各选项得票」，25 是「最终结果（含冠军）+ 投票时段」，
 * 所以趋势卡只在进行中出现，时段卡只在结束后出现。
 *
 * 趋势图的桶粒度由投票时长决定（25 底部有说明），
 * 所以这一版只渲染后端给的数组，前端不做分桶——分桶规则写在前端会和服务端
 * 的「已过 37%」对不上。
 */
const poll = ref<Poll | null>(null)
const stats = ref<ReturnType<typeof import('@/api/poll').fetchPollStats> extends Promise<infer T> ? T : never>()

const loading = ref(true)
const pollId = ref('')
const endSheet = ref(false)

const isEnded = computed(() => !!poll.value && poll.value.rules.endAt <= Date.now())
const isSurvey = computed(() => poll.value?.type === 'survey')

/**
 * 投票看选项票数之和，问卷没有选项，直接看回答数。
 * 之前问卷这里固定是 0，数据页的「累计回答」「总票数」都跟着显示 0。
 */
const totalVotes = computed(() => {
  if (!poll.value) return 0
  if (isSurvey.value) return poll.value.answerCount ?? 0
  return poll.value.options.reduce((s, o) => s + o.votes, 0)
})

const ranked = computed(() =>
  [...(poll.value?.options ?? [])]
    .map((o, i) => ({ ...o, pct: percent(o.votes, totalVotes.value), origin: i }))
    .sort((a, b) => b.votes - a.votes || a.origin - b.origin)
)

/** 25 把冠军单独放进浅紫卡，排行里从第 2 名接着排 */
const runnerUps = computed(() => (isEnded.value ? ranked.value.slice(1) : ranked.value))

const maxVotes = computed(() => ranked.value[0]?.votes ?? 0)
const leadGap = computed(() => (ranked.value.length > 1 ? ranked.value[0].votes - ranked.value[1].votes : 0))

/** 25 的「投票用时」：从创建到截止的天数，向上取整 */
const durationDays = computed(() => {
  if (!poll.value) return 0
  const span = poll.value.rules.endAt - poll.value.createdAt
  return Math.max(1, Math.ceil(span / 86400000))
})

/** 柱状图最高值，用来算每根柱子的高度百分比 */
const trendMax = computed(() => Math.max(1, ...(stats.value?.trend ?? []).map((t) => t.value)))

/** 时段条的峰值：设计稿只给最高的那根上主色 */
const peakHour = computed(() => Math.max(1, ...(stats.value?.hours ?? []).map((h) => h.value)))

async function load() {
  loading.value = true
  try {
    const [p, s] = await Promise.all([fetchPoll(pollId.value), fetchPollStats(pollId.value)])
    poll.value = p
    stats.value = s
    syncShareMenu(p.rules.allowShare)
  } finally {
    loading.value = false
  }
}

onLoad((q) => {
  pollId.value = (q?.id as string) ?? ''
})
onMounted(load)

onPullDownRefresh(async () => {
  await load()
  uni.stopPullDownRefresh()
})

/** 24 的「提前结束」：不可逆，走底部确认面板 */
async function onEnd() {
  if (!poll.value) return
  endSheet.value = false
  await endPoll(poll.value.id)
  await load()
  uni.showToast({ title: '已结束', icon: 'none' })
}

/** 导航栏右侧的「···」：设计稿是操作入口，不是一个直达结果页的图标 */
function onMore() {
  // 问卷没有「结果页」（没有选项和票数），入口落到回答记录，
  // 从那里再进汇总；投票才是结果页。
  uni.showActionSheet({
    itemList: [isSurvey.value ? '查看回答记录' : '查看结果页'],
    success: (r) => {
      if (r.tapIndex !== 0) return
      if (isSurvey.value) {
        go(ROUTES.surveyAnswers, { id: pollId.value })
      } else {
        goResult()
      }
    }
  })
}

function goVoters() {
  go(ROUTES.detailVoters, { id: pollId.value })
}

function goResult() {
  go(ROUTES.detailResult, { id: pollId.value })
}

/** 27/80 分享页：海报 + 分享渠道 */
function goShare() {
  go(ROUTES.share, { id: pollId.value })
}

onShareAppMessage(() => (poll.value ? buildShareMessage(poll.value) : { title: '杜雅轩', path: '/pages/index/index' }))
</script>

<template>
  <view class="data">
    <AppNavBar :title="isSurvey ? '问卷数据' : '投票数据'">
      <template #right>
        <view class="data__nav-btn" @tap="onMore">
          <AppIcon name="ellipsis" :size="17" color="#09090B" />
        </view>
      </template>
    </AppNavBar>

    <view v-if="loading" class="data__body">
      <AppSkeleton type="stats" />
    </view>

    <scroll-view v-else-if="poll && stats" class="data__scroll" scroll-y>
      <view class="data__content">
        <!-- 头部黑卡 -->
        <view class="hero">
          <view class="hero__top">
            <view class="hero__badge">
              <view class="hero__dot" :class="{ 'hero__dot--ended': isEnded }" />
              <text class="hero__badge-text">{{ isEnded ? '已结束' : '进行中' }}</text>
            </view>
            <text class="hero__right">
              {{ isEnded ? `${formatDateTime(poll.rules.endAt)} 截止` : formatRemaining(poll.rules.endAt) }}
            </text>
          </view>

          <text class="hero__title">{{ poll.title }}</text>

          <view class="hero__stat">
            <view class="hero__stat-left">
              <text class="hero__stat-label">{{ isSurvey ? '已收到回答' : '已投票人数' }}</text>
              <view class="hero__stat-num-row">
                <text class="hero__stat-num">{{ isSurvey ? poll.answerCount ?? 0 : poll.voterCount }}</text>
                <text class="hero__stat-unit">{{ isSurvey ? '份' : '人' }}</text>
              </view>
            </view>
            <view class="hero__stat-right">
              <text class="hero__stat-total">
                {{ isSurvey ? `累计 ${totalVotes} 份回答` : `累计 ${totalVotes} 票` }}
              </text>
              <text class="hero__stat-note">
                {{
                  isEnded
                    ? `平均每天 ${Math.round(totalVotes / durationDays)} ${isSurvey ? '份' : '票'}`
                    : `最近${isSurvey ? '提交' : '投票'} ${formatRelative(stats.latestAt)}`
                }}
              </text>
            </view>
          </view>

          <view class="hero__progress">
            <view class="hero__progress-head">
              <text class="hero__progress-label">{{ isSurvey ? '收集周期' : '投票周期' }}</text>
              <text class="hero__progress-right">
                {{
                  isEnded
                    ? `${formatDate(poll.createdAt)} - ${formatDate(poll.rules.endAt)}`
                    : `已过 ${stats.progress}%`
                }}
              </text>
            </view>
            <view class="hero__track">
              <view class="hero__fill" :style="{ width: `${isEnded ? 100 : stats.progress}%` }" />
            </view>
          </view>
        </view>

        <!-- KPI 三宫格 -->
        <view class="kpis">
          <view class="kpi">
            <text class="kpi__label">{{ isEnded ? (isSurvey ? '总回答' : '总票数') : '今日新增' }}</text>
            <text class="kpi__value">{{ isEnded ? totalVotes : `+${stats.todayNew}` }}</text>
          </view>
          <view class="kpi">
            <text class="kpi__label">{{ isEnded ? (isSurvey ? '收集用时' : '投票用时') : '最高得票' }}</text>
            <text class="kpi__value">{{ isEnded ? `${durationDays} 天` : `${maxVotes} 票` }}</text>
          </view>
          <view class="kpi">
            <text class="kpi__label">{{ isEnded ? '最高得票' : '领先优势' }}</text>
            <text class="kpi__value">
              {{ isEnded ? `${percent(maxVotes, totalVotes)}%` : `${leadGap} 票` }}
            </text>
          </view>
        </view>

        <!-- 24 的趋势（25 没有这一块） -->
        <view v-if="!isEnded" class="trend">
          <view class="trend__head">
            <text class="trend__title">{{ isSurvey ? '提交趋势' : '投票趋势' }}</text>
            <text class="trend__sub">按天 · 峰值 {{ trendMax }} {{ isSurvey ? '份' : '票' }}</text>
          </view>

          <view class="trend__bars">
            <view v-for="t in stats.trend" :key="t.label" class="bar">
              <text class="bar__value" :class="{ 'bar__value--peak': t.value === trendMax }">
                {{ t.value }}
              </text>
              <view class="bar__track">
                <view
                  class="bar__fill"
                  :class="{ 'bar__fill--peak': t.value === trendMax }"
                  :style="{ height: `${Math.round((t.value / trendMax) * 72)}px` }"
                />
              </view>
              <text class="bar__label">{{ t.label }}</text>
            </view>
          </view>
        </view>

        <!-- 各选项得票 / 25 的最终结果 -->
        <view v-if="ranked.length" class="rank">
          <view class="rank__head">
            <text class="rank__title">{{ isEnded ? '最终结果' : '各选项得票' }}</text>
            <view class="rank__link" @tap="goVoters">
              <text class="rank__link-text">{{ isSurvey ? '回答记录' : '投票记录' }}</text>
              <AppIcon name="chevron-right" :size="12" color="#A1A1AA" />
            </view>
          </view>

          <!-- 25 的冠军卡 -->
          <view v-if="isEnded" class="winner">
            <view class="winner__top">
              <text class="winner__label">得票最高</text>
              <text class="winner__stat">{{ ranked[0].votes }} 票 · {{ ranked[0].pct }}%</text>
            </view>
            <text class="winner__name">{{ ranked[0].title }}</text>
          </view>

          <view v-for="(opt, i) in runnerUps" :key="opt.id" class="rank__row">
            <view class="rank__row-top">
              <view class="rank__left">
                <view
                  class="rank__badge"
                  :class="{ 'rank__badge--first': !isEnded && i === 0 }"
                >
                  <text
                    class="rank__badge-text"
                    :class="{ 'rank__badge-text--first': !isEnded && i === 0 }"
                  >
                    {{ isEnded ? i + 2 : i + 1 }}
                  </text>
                </view>
                <text class="rank__name" :class="{ 'rank__name--first': !isEnded && i === 0 }">
                  {{ opt.title }}
                </text>
              </view>
              <view class="rank__right">
                <text class="rank__votes">{{ opt.votes }} 票</text>
                <text class="rank__pct" :class="{ 'rank__pct--first': !isEnded && i === 0 }">
                  {{ opt.pct }}%
                </text>
              </view>
            </view>
            <view class="rank__track">
              <view
                class="rank__fill"
                :class="{ 'rank__fill--first': !isEnded && i === 0 }"
                :style="{ width: `${opt.pct}%` }"
              />
            </view>
          </view>
        </view>

        <!-- 25 独有的时段分布 -->
        <view v-if="isEnded" class="hours">
          <view class="hours__head">
            <text class="hours__title">{{ isSurvey ? '提交' : '投票' }}时段</text>
            <text class="hours__sub">{{ totalVotes }} {{ isSurvey ? '份' : '票' }}</text>
          </view>

          <view v-for="h in stats.hours" :key="h.label" class="slot">
            <view class="slot__top">
              <text class="slot__name">{{ h.label }}</text>
              <text class="slot__count">{{ h.value }} {{ isSurvey ? '份' : '票' }} · {{ h.pct }}%</text>
            </view>
            <view class="slot__track">
              <view
                class="slot__fill"
                :class="{ 'slot__fill--peak': h.value === peakHour }"
                :style="{ width: `${h.pct}%` }"
              />
            </view>
          </view>

          <text class="hours__note">{{ stats.peakText }}</text>
        </view>
      </view>
    </scroll-view>

    <view v-if="poll" class="data__actions" :style="{ paddingBottom: bottomInset(20) }">
      <AppButton v-if="!isEnded" type="subtle" size="cta" class="data__action" @tap="endSheet = true">
        提前结束
      </AppButton>
      <AppButton size="cta" icon="share-2" class="data__action" @tap="goShare">
        {{ isEnded ? '生成海报' : `分享${isSurvey ? '问卷' : '投票'}` }}
      </AppButton>
    </view>

    <!-- 提前结束的二次确认 -->
    <AppSheet
      :visible="endSheet"
      variant="confirm"
      title="提前结束投票？"
      desc="结束后不能再接收新票，已投的票与统计都会保留，结果立即公布。"
      @close="endSheet = false"
    >
      <view class="confirm-actions">
        <view class="flex-1">
          <AppButton type="subtle" size="dialog" @tap="endSheet = false">取消</AppButton>
        </view>
        <view class="flex-1">
          <AppButton type="danger" size="dialog" @tap="onEnd">结束投票</AppButton>
        </view>
      </view>
    </AppSheet>
  </view>
</template>

<script lang="ts">
export default { name: 'CreatorDataPage' }
</script>

<style lang="scss" scoped>
.data {
  /* 定高：scroll-view 需要父级有确定高度，min-height 在真机上会让它塌成 0 高 */
  height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  /* 设计稿两侧操作都是 34×34 的白底圆钮 */
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

  &__content {
    /* 底部操作栏自己处理安全区，这里只要留 20 让最后一块不贴栏 */
    padding: 4px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  &__actions {
    display: flex;
    gap: 10px;
    /* 下边距由 bottomInset() 内联控制（20 + 底部小横条高度），不再用 env() */
    padding: 8px $gutter 0;
    flex-shrink: 0;
  }

  /* 24/25 的两个按钮等宽 */
  &__action {
    flex: 1;
  }
}

/* 黑卡：r20 pad18 gap12 */
.hero {
  padding: 18px;
  border-radius: 20px;
  background: $ink;
  display: flex;
  flex-direction: column;
  gap: 12px;

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

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
    background: $success;

    &--ended {
      background: $faint;
    }
  }

  &__badge-text {
    font-size: 11px;
    font-weight: 500;
    color: #fff;
  }

  &__right {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.6);
  }

  &__title {
    font-size: 15px;
    font-weight: 600;
    color: #fff;
    line-height: 1.4;
  }

  /* 左：标签 10 + 28 号主色数字；右：累计 13/600 + 说明 9 */
  &__stat {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
  }

  &__stat-left {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__stat-label {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.5);
  }

  &__stat-num-row {
    display: flex;
    align-items: flex-end;
    gap: 4px;
  }

  &__stat-num {
    font-size: 28px;
    font-weight: 700;
    color: $accent;
    /* 纯数字没有下行字母，1 号行高正好容纳字形，避免 1.05 多出 4px 撑破卡 */
    line-height: 1;
  }

  &__stat-unit {
    font-size: 12px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.6);
  }

  &__stat-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }

  &__stat-total {
    font-size: 13px;
    font-weight: 600;
    color: #fff;
  }

  &__stat-note {
    font-size: 9px;
    color: rgba(255, 255, 255, 0.5);
  }

  &__progress {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__progress-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__progress-label {
    font-size: 9px;
    color: rgba(255, 255, 255, 0.5);
  }

  &__progress-right {
    font-size: 9px;
    color: rgba(255, 255, 255, 0.6);
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
  }
}

/* KPI：r14 pad13 gap5，标签 10/$faint，数值 18/bold */
.kpis {
  display: flex;
  gap: 10px;
}

.kpi {
  flex: 1;
  padding: 13px;
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  flex-direction: column;
  gap: 5px;
  /* 数字字体（Inter/DIN）行框会比 CSS line-height 高 1px 左右，裁掉避免溢出卡 */
  overflow: hidden;

  &__label {
    font-size: 10px;
    color: $faint;
  }

  &__value {
    font-size: 18px;
    font-weight: 700;
    color: $ink;
    line-height: 1.2;
  }
}

/* 趋势柱状：r18 pad16 gap13，柱子最高 72 */
.trend {
  padding: 16px;
  border-radius: 18px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  flex-direction: column;
  gap: 13px;

  &__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  &__title {
    font-size: 13px;
    font-weight: 600;
    color: $ink;
  }

  &__sub {
    font-size: 10px;
    color: $faint;
  }

  &__bars {
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }
}

.bar {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;

  &__value {
    font-size: 10px;
    font-weight: 600;
    color: $muted;

    &--peak {
      color: $accent;
    }
  }

  &__track {
    width: 100%;
    height: 72px;
    display: flex;
    align-items: flex-end;
  }

  &__fill {
    width: 100%;
    border-radius: 4px;
    background: $line;
    min-height: 2px;

    &--peak {
      background: $accent;
    }
  }

  &__label {
    font-size: 9px;
    color: $faint;
  }
}

/* 各选项得票 / 最终结果：r18 pad16 gap13 */
.rank {
  padding: 16px;
  border-radius: 18px;
  background: $surface;
  border: 1px solid $line;
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
    flex: 1;
    min-width: 0;
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
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    padding-left: 8px;
  }

  &__votes {
    font-size: 12px;
    color: $muted;
  }

  &__pct {
    font-size: 13px;
    font-weight: 600;
    color: $ink;

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

/* 25 的冠军卡：浅紫底 r12 pad12 gap4 */
.winner {
  padding: 12px;
  border-radius: 12px;
  background: $accent-soft;
  display: flex;
  flex-direction: column;
  gap: 4px;

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__label {
    font-size: 10px;
    font-weight: 500;
    color: $accent-ink;
  }

  &__stat {
    font-size: 11px;
    font-weight: 600;
    color: $accent-ink;
  }

  &__name {
    font-size: 15px;
    font-weight: 600;
    color: $ink;
  }
}

/* 25 的投票时段：r18 pad16 gap13 */
.hours {
  padding: 16px;
  border-radius: 18px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  flex-direction: column;
  gap: 13px;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    font-size: 13px;
    font-weight: 600;
    color: $ink;
  }

  &__sub {
    font-size: 10px;
    color: $faint;
  }

  &__note {
    font-size: 10px;
    color: $faint;
    line-height: 1.5;
  }
}

/* 每个时段：名称/票数一行，下面 6 高细条 */
.slot {
  display: flex;
  flex-direction: column;
  gap: 6px;

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__name {
    font-size: 12px;
    font-weight: 500;
    color: $ink;
  }

  &__count {
    font-size: 11px;
    color: $muted;
  }

  &__track {
    height: 6px;
    border-radius: 3px;
    background: $bg;
    overflow: hidden;
  }

  &__fill {
    height: 100%;
    border-radius: 3px;
    background: #d4d4d8;

    &--peak {
      background: $accent;
    }
  }
}

.confirm-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
