<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import AppConfirmSheet from '@/components/base/AppConfirmSheet.vue'
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
import { cacheGet, cacheSet, cacheDrop, cacheKey } from '@/utils/cache'
import AppToast from '@/components/base/AppToast.vue'
import { toast } from '@/utils/toast'

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
/** 未归类总数：列表分批取，计数不能用当前这一页的长度 */
const unclassifiedTotal = ref(0)
const loading = ref(true)
const loadError = ref(false)
const surveyId = ref('')

const classifiedCount = computed(() => candidates.value.reduce((s, c) => s + c.answerCount, 0))

/** 汇总页快照：问卷 + 候选分组 + 未归类 */
interface SummarySnapshot {
  poll: Poll
  candidates: SummaryCandidate[]
  unclassified: UnclassifiedAnswer[]
  unclassifiedTotal: number
}

async function load() {
  const cached = cacheGet<SummarySnapshot>(cacheKey.pollSummary(surveyId.value))
  if (cached) {
    poll.value = cached.poll
    candidates.value = cached.candidates
    unclassified.value = cached.unclassified
    unclassifiedTotal.value = cached.unclassifiedTotal ?? cached.unclassified.length
  }
  // 从 85/86 退回来时页面是复用的，有内容就不该再铺一次骨架
  loading.value = !cached
  loadError.value = false
  if (!surveyId.value) {
    loading.value = false
    loadError.value = true
    return
  }
  try {
    const p = await fetchPoll(surveyId.value)
    poll.value = p
    const [c, u] = await Promise.all([
      fetchSummaryCandidates(p.id),
      fetchUnclassified(p.id)
    ])
    candidates.value = c
    unclassified.value = u.list
    unclassifiedTotal.value = u.total
    cacheSet(cacheKey.pollSummary(surveyId.value), {
      poll: p,
      candidates: c,
      unclassified: u.list,
      unclassifiedTotal: u.total
    })
  } catch {
    if (!poll.value) loadError.value = true
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
const remergeVisible = ref(false)
/** 归并请求进行中：按钮转圈、面板不关，代替原生黑框 loading */
const remerging = ref(false)

function remerge() {
  remergeVisible.value = true
}

/** 请求中不允许关面板，避免归并还在跑就又点一次 */
function closeRemerge() {
  if (remerging.value) return
  remergeVisible.value = false
}

async function doRemerge() {
  if (remerging.value) return
  remerging.value = true
  try {
    await remergeSummary(surveyId.value)
    // 重新归并后旧分组全部作废
    cacheDrop(cacheKey.pollSummary(surveyId.value))
    await load()
    remergeVisible.value = false
    toast.success('已重新归并')
  } catch {
    // 失败原因由请求层统一 toast，这里不再重复
  } finally {
    remerging.value = false
  }
}

const MAX_DRAFT_OPTIONS = 12

/**
 * 候选 → 草稿选项。
 *
 * 创建页最多 12 个：超出的不能静默丢掉，前 11 个照常带入，
 * 剩下的合并成「其他」，回答原文仍保留在问卷里。
 * 老数据可能留下同名候选（去重是后加的），这里再兜一次底。
 */
function draftOptions(list: SummaryCandidate[]): Array<{ title: string; desc: string }> {
  const used = new Set<string>()
  const make = (c: SummaryCandidate) => {
    const base = (c.title.trim() || '未命名选项').slice(0, 12)
    let title = base
    let n = 2
    while (used.has(title)) {
      const suffix = `（${n++}）`
      title = base.slice(0, 12 - suffix.length) + suffix
    }
    used.add(title)
    return { title, desc: c.desc }
  }

  if (list.length <= MAX_DRAFT_OPTIONS) return list.map(make)
  const head = list.slice(0, MAX_DRAFT_OPTIONS - 1).map(make)
  // 候选里本来就有「其他」时再错开一个名字
  let other = '其他'
  let n = 2
  while (used.has(other)) other = `其他${n++}`
  head.push({ title: other, desc: `其余 ${list.length - head.length} 个候选` })
  return head
}

/** 进入创建流程第二步：选项已带入 */
function goContent() {
  const draft = useDraftStore()
  draft.startCreate('single')
  draft.patch({
    sourceSurveyId: surveyId.value,
    title: poll.value ? `${poll.value.title} · 汇总投票` : '',
    desc: `由 ${classifiedCount.value} 条问卷回答汇总而成，得票最高者即为最终方案。`,
    options: draftOptions(candidates.value)
  })
  go(ROUTES.createContent)
}
</script>

<template>
  <view class="summary">
    <AppToast />
    <AppNavBar title="整理回答">
      <template #right>
        <text class="summary__remerge" @tap="remerge">重新归并</text>
      </template>
    </AppNavBar>

    <view v-if="loading" class="summary__body">
      <AppSkeleton type="list" />
    </view>

    <AppEmpty
      v-else-if="loadError"
      icon="wifi-off"
      title="汇总数据加载失败"
      desc="网络不太稳定，或者你没有整理这份问卷的权限"
      action="重新加载"
      action-icon="refresh-cw"
      @action="load"
    />

    <template v-else>
      <scroll-view class="summary__scroll" scroll-y>
        <view class="summary__content">
          <!-- 来源卡 -->
          <view class="source">
            <text class="source__label">来源问卷</text>
            <text class="source__title">{{ poll?.title }}</text>
            <text class="source__meta">
              {{ poll?.answerCount ?? classifiedCount + unclassifiedTotal }} 条回答 ·
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
              <text class="count__num count__num--warn">{{ unclassifiedTotal }} 条</text>
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
          <view v-if="unclassifiedTotal" class="unclassified" @tap="goUnclassified">
            <view class="unclassified__icon">
              <AppIcon name="triangle-alert" :size="15" color="#B45309" />
            </view>
            <view class="unclassified__text">
              <text class="unclassified__title">{{ unclassifiedTotal }} 条回答没有归类</text>
              <text class="unclassified__desc">可新建选项或归入已有</text>
            </view>
            <AppIcon name="chevron-right" :size="14" color="#B45309" />
          </view>
        </view>
      </scroll-view>

      <view class="summary__actions" :style="{ paddingBottom: bottomInset(20) }">
        <AppButton type="subtle" size="cta" class="summary__action" @tap="goBack">取消</AppButton>
        <AppButton size="cta" class="summary__action" @tap="goContent">回到内容填写</AppButton>
      </view>
    </template>

    <AppConfirmSheet
      :visible="remergeVisible"
      title="重新归并？"
      desc="会按回答原文重新分组，手动调整过的选项标题和归类会丢失。"
      confirm-text="重新归并"
      :loading="remerging"
      @close="closeRemerge"
      @confirm="doRemerge"
    />
  </view>
</template>

<script lang="ts">
export default { name: 'SummaryIndexPage' }
</script>

<style lang="scss" scoped>
.summary {
  /* 定高：scroll-view 需要父级有确定高度，min-height 在真机上会让它塌成 0 高 */
  height: 100vh;
  /* #ifdef H5 */
  height: 100dvh;
  /* #endif */
  background: $bg;
  display: flex;
  flex-direction: column;

  /* 84 页头的「重新归并」是 14 号灰字 */
  &__remerge {
    font-size: $fs-14;
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
    font-size: $fs-15;
    font-weight: 600;
  }
}

/* 来源卡：r14 pad14 gap5 */
.source {
  padding: 14px;
  border-radius: $r-input;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  flex-direction: column;
  gap: 5px;

  &__label {
    font-size: $fs-10;
    color: $faint;
  }

  &__title {
    font-size: $fs-13;
    font-weight: 600;
    color: $ink;
    line-height: 1.4;
  }

  &__meta {
    font-size: $fs-11;
    color: $faint;
  }
}

/* 归并规则条：$accent-soft r12 pad[10,14] gap8 */
.rule-row {
  padding: 10px 14px;
  border-radius: $r-md;
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
    font-size: $fs-11;
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
  border-radius: $r-input;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  flex-direction: column;
  gap: 5px;

  &__label {
    font-size: $fs-10;
    color: $faint;
  }

  &__num {
    font-size: $fs-18;
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
    font-size: $fs-13;
    font-weight: 600;
    color: $ink;
  }

  &__all {
    font-size: $fs-11;
    color: $accent;
  }
}

/* 分组卡：r14 pad12 gap10，左侧 20 的勾选块 */
.cand {
  padding: 12px;
  border-radius: $r-input;
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
    border-radius: $r-xs;
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
    font-size: $fs-14;
    font-weight: 600;
    color: $ink;
  }

  &__badge {
    padding: 2px 6px;
    border-radius: $r-xs;
    background: $accent-soft;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  &__badge-text {
    font-size: $fs-10;
    color: $accent-ink;
  }

  &__desc {
    font-size: $fs-11;
    color: $muted;
  }

  &__quote {
    padding: 8px 10px;
    border-radius: $r-chip;
    background: $subtle;
  }

  &__sample {
    font-size: $fs-11;
    color: $faint;
    line-height: 1.5;
  }
}

/* 未归类提示：$warning-soft r14 pad[12,14] gap10，图标装 28 的白底圆角块 */
.unclassified {
  padding: 12px 14px;
  border-radius: $r-input;
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
    font-size: $fs-12;
    font-weight: 600;
    color: $warning;
  }

  &__desc {
    font-size: $fs-10;
    color: $muted;
  }
}
</style>
