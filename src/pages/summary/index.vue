<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import {
  fetchPoll,
  fetchSummaryCandidates,
  fetchUnclassified,
  remergeSummary
} from '@/api/poll'
import { useDraftStore } from '@/stores/draft'
import { formatDateTime } from '@/utils/format'
import { bottomInset } from '@/utils/platform'
import type { Poll, SummaryCandidate, UnclassifiedAnswer } from '@/types/api'
import { ROUTES, back, go } from '@/utils/router'

/**
 * 84 汇总 · 整理回答
 *
 * 这一层在创建流程之外：从 78 点「汇总成投票」进来，先把 89 条回答
 * 归并成最多 12 个候选选项，确认后才进 28→29→30 三步。
 *
 * 上限 12 是有原因的：投票里一屏放 4 个选项、3 屏就到头了，
 * 再多参与者根本看不完。超出的并进「其他」，原文不丢。
 */
const poll = ref<Poll | null>(null)
const candidates = ref<SummaryCandidate[]>([])
const unclassified = ref<UnclassifiedAnswer[]>([])
const loading = ref(true)
const surveyId = ref('')

const classifiedCount = computed(() => candidates.value.reduce((s, c) => s + c.answerCount, 0))

async function load() {
  loading.value = true
  try {
    const p = await fetchPoll(surveyId.value)
    poll.value = p
    const [c, u] = await Promise.all([
      fetchSummaryCandidates(p.id),
      fetchUnclassified(p.id)
    ])
    candidates.value = c
    unclassified.value = u
  } finally {
    loading.value = false
  }
}

onLoad((q) => {
  surveyId.value = (q?.surveyId as string) ?? (q?.id as string) ?? ''
})
/**
 * 用 onShow 而不是 onMounted：从 85/86 回来时页面实例还在，
 * onMounted 不会再跑，改动过的选项数和未归类条数就会是旧的。
 */
onShow(load)

function editOption(c: SummaryCandidate) {
  go(ROUTES.summaryOption, { id: c.id, surveyId: surveyId.value })
}

function goUnclassified() {
  go(ROUTES.summaryUnclassified, { id: surveyId.value })
}

function goBack() {
  back()
}

/**
 * 「重新归并」：后端清掉这次的整理结果，按原文重新分组。
 * 手动改过的标题、归到别的选项的回答都会丢，所以要二次确认。
 */
function remerge() {
  uni.showModal({
    title: '重新归并？',
    content: '会按回答原文重新分组，手动调整过的选项标题和归类会丢失。',
    confirmText: '重新归并',
    success: async (r) => {
      if (!r.confirm) return
      uni.showLoading({ title: '正在归并' })
      try {
        await remergeSummary(surveyId.value)
        await load()
        uni.showToast({ title: '已重新归并', icon: 'none' })
      } catch {
        uni.showToast({ title: '归并失败，请重试', icon: 'none' })
      } finally {
        uni.hideLoading()
      }
    }
  })
}

/** 进入创建流程第二步：选项已带入 */
function goContent() {
  const draft = useDraftStore()
  draft.startCreate('single')
  draft.patch({
    sourceSurveyId: surveyId.value,
    title: poll.value ? `${poll.value.title} · 汇总投票` : '',
    desc: `由 ${classifiedCount.value} 条问卷回答汇总而成，得票最高者即为最终方案。`,
    // 创建页最多 12 个选项；这里不要截成 4，否则第 5 个以后的候选会被静默丢掉
    options: candidates.value.slice(0, 12).map((c) => ({ title: c.title, desc: c.desc }))
  })
  go(ROUTES.createContent)
}
</script>

<template>
  <view class="summary">
    <AppNavBar title="整理回答">
      <template #right>
        <text class="summary__remerge" @tap="remerge">重新归并</text>
      </template>
    </AppNavBar>

    <view v-if="loading" class="summary__body">
      <AppSkeleton type="list" />
    </view>

    <template v-else>
      <scroll-view class="summary__scroll" scroll-y>
        <view class="summary__content">
          <!-- 来源卡 -->
          <view class="source">
            <text class="source__label">来源问卷</text>
            <text class="source__title">{{ poll?.title }}</text>
            <text class="source__meta">
              {{ classifiedCount + unclassified.length }} 条回答 ·
              {{ poll ? formatDateTime(poll.rules.endAt) : '' }} 截止
            </text>
          </view>

          <!-- 归并规则：浅紫说明条（84 的 Rule Row） -->
          <view class="rule-row" hover-class="rule-row--active" @tap="remerge">
            <AppIcon name="sparkles" :size="14" color="#4F46E5" />
            <text class="rule-row__text">
              相似回答合并 · 标题 ≤12 字 · 说明 ≤20 字 · 上限 12 个
            </text>
            <AppIcon name="chevron-right" :size="14" color="#4F46E5" />
          </view>

          <!-- 三个数字：r14 pad13 gap5，数值 18/bold -->
          <view class="counts">
            <view class="count">
              <text class="count__label">候选选项</text>
              <text class="count__num">{{ candidates.length }}</text>
            </view>
            <view class="count">
              <text class="count__label">已归类</text>
              <text class="count__num">{{ classifiedCount }} 条</text>
            </view>
            <view class="count" @tap="goUnclassified">
              <text class="count__label">未归类</text>
              <text class="count__num count__num--warn">{{ unclassified.length }} 条</text>
            </view>
          </view>

          <!-- 归类结果 -->
          <view class="candidates">
            <view class="candidates__head">
              <text class="candidates__title">归类结果</text>
              <text class="candidates__all">全部 {{ candidates.length }} 个 ›</text>
            </view>

            <view
              v-for="(c, i) in candidates"
              :key="c.id"
              class="cand anim anim--fade-up"
              :style="{ animationDelay: `${Math.min(i, 8) * 40}ms` }"
              hover-class="cand--active"
              @tap="editOption(c)"
            >
              <view class="cand__check">
                <AppIcon name="check" :size="12" color="#FFFFFF" :stroke-width="2.6" />
              </view>
              <view class="cand__body">
                <view class="cand__top">
                  <text class="cand__title">{{ c.title }}</text>
                  <view class="cand__badge">
                    <text class="cand__badge-text">{{ c.answerCount }} 条</text>
                  </view>
                </view>
                <text class="cand__desc">{{ c.desc }}</text>
                <view class="cand__quote">
                  <text class="cand__sample">{{ c.sample }}</text>
                </view>
              </view>
            </view>

            <AppEmpty
              v-if="!candidates.length"
              icon="sparkles"
              title="还没有归并出候选选项"
              desc="回答太少或差异太大时，可以手动新建选项"
            />
          </view>

          <!-- 未归类提示 -->
          <view v-if="unclassified.length" class="unclassified" @tap="goUnclassified">
            <view class="unclassified__icon">
              <AppIcon name="triangle-alert" :size="15" color="#D97706" />
            </view>
            <view class="unclassified__text">
              <text class="unclassified__title">{{ unclassified.length }} 条回答没有归类</text>
              <text class="unclassified__desc">可新建选项或归入已有</text>
            </view>
            <AppIcon name="chevron-right" :size="14" color="#D97706" />
          </view>
        </view>
      </scroll-view>

      <view class="summary__actions" :style="{ paddingBottom: bottomInset(20) }">
        <AppButton type="subtle" size="cta" class="summary__action" @tap="goBack">取消</AppButton>
        <AppButton size="cta" class="summary__action" @tap="goContent">回到内容填写</AppButton>
      </view>
    </template>
  </view>
</template>

<script lang="ts">
export default { name: 'SummaryIndexPage' }
</script>

<style lang="scss" scoped>
.summary {
  /* 定高：scroll-view 需要父级有确定高度，min-height 在真机上会让它塌成 0 高 */
  height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  /* 84 页头的「重新归并」是 14 号灰字 */
  &__remerge {
    font-size: 14px;
    color: $muted;
  }

  &__body {
    flex: 1;
  }

  &__scroll {
    flex: 1;
    height: 0;
  }

  &__content {
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

  /* 84：取消 110 宽、主按钮吃掉剩余宽度 */
  &__action {
    flex: 1;
    font-size: 15px;
    font-weight: 600;
  }
}

/* 来源卡：r14 pad14 gap5 */
.source {
  padding: 14px;
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  flex-direction: column;
  gap: 5px;

  &__label {
    font-size: 10px;
    color: $faint;
  }

  &__title {
    font-size: 13px;
    font-weight: 600;
    color: $ink;
    line-height: 1.4;
  }

  &__meta {
    font-size: 11px;
    color: $faint;
  }
}

/* 归并规则条：$accent-soft r12 pad[10,14] gap8 */
.rule-row {
  padding: 10px 14px;
  border-radius: 12px;
  background: $accent-soft;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: opacity $dur-fast $ease-both;

  &--active {
    opacity: 0.85;
  }

  &__text {
    flex: 1;
    font-size: 11px;
    color: $accent-ink;
    line-height: 1.4;
  }
}

.counts {
  display: flex;
  gap: 10px;
}

/* KPI：r14 pad13 gap5，标签 10/$faint，数值 18/bold */
.count {
  flex: 1;
  padding: 13px;
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  flex-direction: column;
  gap: 5px;

  &__label {
    font-size: 10px;
    color: $faint;
  }

  &__num {
    font-size: 18px;
    font-weight: 700;
    color: $ink;
    line-height: 1.2;

    &--warn {
      color: $warning;
    }
  }
}

.candidates {
  display: flex;
  flex-direction: column;
  gap: 10px;

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

  &__all {
    font-size: 11px;
    color: $accent;
  }
}

/* 分组卡：r14 pad12 gap10，左侧 20 的勾选块 */
.cand {
  padding: 12px;
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  transition: background-color $dur-fast $ease-both;

  &--active {
    background: $subtle;
  }

  &__check {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    background: $accent;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 1px;
  }

  &__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 7px;
    min-width: 0;
  }

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  &__title {
    flex: 1;
    font-size: 14px;
    font-weight: 600;
    color: $ink;
  }

  &__badge {
    padding: 2px 6px;
    border-radius: 6px;
    background: $accent-soft;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  &__badge-text {
    font-size: 10px;
    color: $accent-ink;
  }

  &__desc {
    font-size: 11px;
    color: $muted;
  }

  &__quote {
    padding: 8px 10px;
    border-radius: 8px;
    background: $subtle;
  }

  &__sample {
    font-size: 11px;
    color: $faint;
    line-height: 1.5;
  }
}

/* 未归类提示：$warning-soft r14 pad[12,14] gap10，图标装 28 的白底圆角块 */
.unclassified {
  padding: 12px 14px;
  border-radius: 14px;
  background: $warning-soft;
  display: flex;
  align-items: center;
  gap: 10px;

  &__icon {
    width: 28px;
    height: 28px;
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__title {
    font-size: 12px;
    font-weight: 600;
    color: $warning;
  }

  &__desc {
    font-size: 10px;
    color: $muted;
  }
}
</style>
