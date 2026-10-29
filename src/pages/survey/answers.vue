<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app'
import type { Poll, SurveyAnswer } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSheet from '@/components/base/AppSheet.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import {
  fetchPoll,
  fetchAnswers,
  fetchSummaryCandidates,
  fetchUnclassified,
  endPoll
} from '@/api/poll'
import { formatDate, formatDateTime, formatRelative, formatRemaining, charCount } from '@/utils/format'
import { bottomInset } from '@/utils/platform'
import { ROUTES, go } from '@/utils/router'

/**
 * 77 问卷数据 · 回答列表 / 78 问卷数据 · 已截止 · 可汇总
 *
 * 和 24/25 投票数据页分开做的原因：问卷没有选项，柱状图没意义。
 * 这一页的主指标是「收到多少份、平均多少字、多少人跳过」，
 * 下面是逐条回答流——发起人真正要看的是内容，不是分布。
 *
 * 78 相对 77 只多两块：
 *   1. 顶部「89 条回答已整理好」的汇总入口卡（12 个候选 / 76 条已归类 / 13 条未归类）
 *   2. 底部主按钮从「邀请填写」换成「汇总成投票」
 * 汇总入口只在「已截止且回答数 > 0」时出现，进行中不出现——没截止就整理，
 * 等于把半成品答案当成结论。
 */
const poll = ref<Poll | null>(null)
const answers = ref<SurveyAnswer[]>([])
const loading = ref(true)
const pollId = ref('')
const endSheet = ref(false)

/** 78 汇总入口的三块统计：候选数、已归类、未归类，全部按真实汇总结果算 */
const summaryCandidates = ref<Array<{ answerCount: number }>>([])
const summaryUnclassified = ref<Array<unknown>>([])

const isEnded = computed(() => !!poll.value && poll.value.rules.endAt <= Date.now())
const canSummarize = computed(() => isEnded.value && answers.value.length > 0)

const answerCount = computed(() => poll.value?.answerCount ?? answers.value.length)

const avgChars = computed(() => {
  if (!answers.value.length) return 0
  const total = answers.value.reduce((s, a) => s + charCount(a.content), 0)
  return Math.round(total / answers.value.length)
})

/** 跳过未答：空内容的条数（设计稿写 11 人，这里按真实空回答数算） */
const skipped = computed(() => answers.value.filter((a) => !a.content.trim()).length)

/** 汇总统计：候选选项数、已归类、未归类 —— 跟 84 汇总页用同一份数据，避免两边数字打架 */
const summaryMeta = computed(() => ({
  candidates: summaryCandidates.value.length,
  classified: summaryCandidates.value.reduce((s, c) => s + c.answerCount, 0),
  unclassified: summaryUnclassified.value.length
}))

/** 进行中的进度按「已过去的时间 / 总时长」算，截止后固定 100 */
const progress = computed(() => {
  if (!poll.value) return 0
  if (isEnded.value) return 100
  const start = poll.value.createdAt
  const end = poll.value.rules.endAt
  if (!start || end <= start) return 0
  const ratio = ((Date.now() - start) / (end - start)) * 100
  return Math.min(99, Math.max(1, Math.round(ratio)))
})

/** 最后一条回答的提交时间：截止后也用它，不能拿截止时间冒充 */
const lastSubmitText = computed(() => {
  const at = answers.value[0]?.createdAt
  return at ? formatRelative(at) : '暂无提交'
})

/**
 * 这一页要出「平均字数 / 跳过未答」两个统计，只拿第一页算出来的数是错的。
 * 逐页取完（最多 10 页兜底），列表和统计才和顶部的「已收到回答 34 份」对得上。
 */
async function loadAllAnswers(id: string): Promise<SurveyAnswer[]> {
  const first = await fetchAnswers(id)
  let list = first.list
  let cursor = first.cursor
  let more = first.hasMore
  let guard = 0
  while (more && guard++ < 10) {
    const next = await fetchAnswers(id, cursor)
    list = [...list, ...next.list]
    cursor = next.cursor
    more = next.hasMore
  }
  return list
}

async function load() {
  loading.value = true
  try {
    const p = await fetchPoll(pollId.value)
    poll.value = p
    const ended = p.rules.endAt <= Date.now()
    const [list, candidates, unclassified] = await Promise.all([
      loadAllAnswers(p.id),
      ended ? fetchSummaryCandidates(p.id) : Promise.resolve([]),
      ended ? fetchUnclassified(p.id) : Promise.resolve([])
    ])
    answers.value = list
    summaryCandidates.value = candidates
    summaryUnclassified.value = unclassified
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

function goSummary() {
  go(ROUTES.summary, { surveyId: pollId.value })
}

/** 80 分享页：海报 + 分享渠道 */
function goShare() {
  go(ROUTES.share, { id: pollId.value })
}

/** 导航栏「···」：设计稿 77/78 右侧只有一个操作入口，现在只剩「提前截止」 */
function onMore() {
  if (canSummarize.value) {
    uni.showToast({ title: '问卷已截止', icon: 'none' })
    return
  }
  endSheet.value = true
}

/** 77 的「提前截止」：不可逆，走底部确认面板 */
async function doEnd() {
  if (!poll.value) return
  endSheet.value = false
  await endPoll(poll.value.id)
  await load()
  uni.showToast({ title: '已截止', icon: 'none' })
}
</script>

<template>
  <view class="answers">
    <AppNavBar title="问卷数据">
      <template #right>
        <view class="answers__nav-btn" @tap="onMore">
          <AppIcon name="ellipsis" :size="17" color="#09090B" />
        </view>
      </template>
    </AppNavBar>

    <view v-if="loading" class="answers__body">
      <AppSkeleton type="stats" />
    </view>

    <template v-else-if="poll">
      <scroll-view class="answers__scroll" scroll-y>
        <view class="answers__content">
          <!-- 黑卡 -->
          <view class="hero">
            <view class="hero__top">
              <view class="hero__badge">
                <view class="hero__dot" :class="{ 'hero__dot--ended': isEnded }" />
                <text class="hero__badge-text">{{ isEnded ? '已截止' : '进行中' }}</text>
              </view>
              <text class="hero__right">
                {{ isEnded ? `${formatDateTime(poll.rules.endAt)} 截止` : formatRemaining(poll.rules.endAt) }}
              </text>
            </view>

            <text class="hero__title">{{ poll.title }}</text>

            <view class="hero__stat">
              <view class="hero__stat-left">
                <text class="hero__stat-label">已收到回答</text>
                <view class="hero__stat-num-row">
                  <text class="hero__stat-num">{{ answerCount }}</text>
                  <text class="hero__stat-unit">份</text>
                </view>
              </view>
              <view class="hero__stat-right">
                <text class="hero__stat-total">共 {{ poll.viewCount }} 人查看</text>
                <text class="hero__stat-note">
                  {{ isEnded ? '最后提交' : '最近提交' }} {{ lastSubmitText }}
                </text>
              </view>
            </view>

            <view class="hero__progress">
              <view class="hero__progress-head">
                <text class="hero__progress-label">收集周期</text>
                <text class="hero__progress-right">
                  {{ isEnded ? `${formatDate(poll.createdAt)} - ${formatDate(poll.rules.endAt)}` : `已过 ${progress}%` }}
                </text>
              </view>
              <view class="hero__track">
                <view class="hero__fill" :style="{ width: `${progress}%` }" />
              </view>
            </view>
          </view>

          <!-- 78 汇总入口 -->
          <view v-if="canSummarize" class="entry" @tap="goSummary">
            <view class="entry__head">
              <AppIcon name="sparkles" :size="18" color="#4F46E5" />
              <text class="entry__title">{{ answerCount }} 条回答已整理好</text>
            </view>
            <text class="entry__desc">
              自动把相似回答归并成候选选项，逐条确认后一键发布，不用手动整理。
            </text>
            <view class="entry__meta">
              <view class="entry__chip"><text class="entry__chip-text">{{ summaryMeta.candidates }} 个候选选项</text></view>
              <view class="entry__chip"><text class="entry__chip-text">{{ summaryMeta.classified }} 条已归类</text></view>
              <view class="entry__chip"><text class="entry__chip-text">{{ summaryMeta.unclassified }} 条未归类</text></view>
            </view>
          </view>

          <!-- KPI -->
          <view class="kpis">
            <view class="kpi">
              <text class="kpi__label">总回答</text>
              <text class="kpi__value">{{ answerCount }} 份</text>
            </view>
            <view class="kpi">
              <text class="kpi__label">平均字数</text>
              <text class="kpi__value">{{ avgChars }} 字</text>
            </view>
            <view class="kpi">
              <text class="kpi__label">跳过未答</text>
              <text class="kpi__value">{{ skipped }} 人</text>
            </view>
          </view>

          <!-- 回答流 -->
          <view class="responses">
            <view class="responses__head">
              <text class="responses__title">{{ isEnded ? '全部回答' : '最新回答' }}</text>
              <text class="responses__sub">共 {{ answers.length }} 条</text>
            </view>

            <view v-for="a in answers" :key="a.id" class="response">
              <view class="response__avatar">
                <text class="response__initial">{{ a.user ? a.user.name.slice(0, 1) : '匿' }}</text>
              </view>
              <view class="response__body">
                <view class="response__top">
                  <text class="response__name">{{ a.user?.name ?? `#${a.id}` }}</text>
                  <text class="response__time">{{ formatRelative(a.createdAt) }}</text>
                </view>
                <text class="response__text">{{ a.content || '（跳过未答）' }}</text>
              </view>
            </view>

            <AppEmpty
              v-if="!answers.length"
              icon="inbox"
              title="还没有人提交"
              desc="分享出去，邀请同事来填写吧"
            />

          </view>
        </view>
      </scroll-view>

      <view class="answers__actions" :style="{ paddingBottom: bottomInset(20) }">
        <AppButton
          v-if="!canSummarize"
          type="subtle"
          size="cta"
          class="answers__action"
          @tap="endSheet = true"
        >
          提前截止
        </AppButton>
        <AppButton
          size="cta"
          :icon="canSummarize ? 'sparkles' : 'share-2'"
          class="answers__action"
          @tap="canSummarize ? goSummary() : goShare()"
        >
          {{ canSummarize ? '汇总成投票' : '邀请填写' }}
        </AppButton>
      </view>
    </template>

    <!-- 提前截止的二次确认 -->
    <AppSheet
      :visible="endSheet"
      variant="confirm"
      title="提前截止收集？"
      desc="截止后不能再提交新回答，已收到的回答与统计都会保留。"
      @close="endSheet = false"
    >
      <view class="confirm-actions">
        <view class="flex-1">
          <AppButton type="subtle" size="dialog" @tap="endSheet = false">取消</AppButton>
        </view>
        <view class="flex-1">
          <AppButton type="danger" size="dialog" @tap="doEnd">截止收集</AppButton>
        </view>
      </view>
    </AppSheet>
  </view>
</template>

<script lang="ts">
export default { name: 'SurveyAnswersPage' }
</script>

<style lang="scss" scoped>
.answers {
  /* 定高：scroll-view 需要父级有确定高度，min-height 在真机上会让它塌成 0 高 */
  height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  &__body {
    flex: 1;
  }

  /* 77/78 右侧是 34 的白底圆钮 */
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

  &__scroll {
    flex: 1;
    height: 0;
  }

  &__content {
    /* 底部操作栏自己处理安全区，这里只要留 20 */
    padding: 4px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  &__actions {
    display: flex;
    gap: 10px;
    /* 下边距由 bottomInset() 内联控制 */
    padding: 8px $gutter 0;
    flex-shrink: 0;
  }

  /* 77/78 的两个按钮等宽 */
  &__action {
    flex: 1;
  }
}

.confirm-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

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

  &__progress-label,
  &__progress-right {
    font-size: 9px;
  }

  &__progress-label {
    color: rgba(255, 255, 255, 0.5);
  }

  &__progress-right {
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

/* 78 汇总入口 */
.entry {
  padding: 16px;
  border-radius: 16px;
  background: $accent-soft;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    color: $accent-ink;
  }

  &__desc {
    font-size: 11px;
    color: $muted;
    line-height: 1.55;
  }

  &__meta {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  &__chip {
    padding: 3px 8px;
    border-radius: 6px;
    background: $surface;
    display: flex;
    align-items: center;
  }

  &__chip-text {
    font-size: 10px;
    color: $accent-ink;
  }
}

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
  /* 数字字体行框比 CSS line-height 高 1px 左右，裁掉避免溢出卡 */
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

.responses {
  padding: 16px 16px 8px;
  border-radius: 16px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  flex-direction: column;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 12px;
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    color: $ink;
  }

  &__sub {
    font-size: 11px;
    color: $faint;
  }

}

.response {
  position: relative;
  display: flex;
  gap: 10px;
  padding: 12px 0;

  /* 设计稿 77：分割线从正文左沿开始（让出头像 + 间距），不横穿头像 */
  & + &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 42px;
    right: 0;
    height: 1px;
    background: $line;
  }

  &__avatar {
    width: 32px;
    height: 32px;
    border-radius: 16px;
    background: $accent-soft;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__initial {
    font-size: 12px;
    font-weight: 600;
    color: $accent-ink;
  }

  &__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__name {
    font-size: 11px;
    font-weight: 600;
    color: $ink;
  }

  &__time {
    font-size: 10px;
    color: $faint;
  }

  &__text {
    font-size: 12px;
    color: $muted;
    line-height: 1.55;
  }
}
</style>
