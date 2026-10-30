<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import AppSheet from '@/components/base/AppSheet.vue'
import AppConfirmSheet from '@/components/base/AppConfirmSheet.vue'
import {
  assignSummaryAnswers,
  createSummaryOption,
  fetchSummaryCandidates,
  fetchUnclassified,
  ignoreSummaryAnswers
} from '@/api/poll'
import type { SummaryCandidate, UnclassifiedAnswer } from '@/types/api'
import { formatRelative } from '@/utils/format'
import { bottomInset } from '@/utils/platform'
import { back } from '@/utils/router'
import { cacheGet, cacheSet, cacheDrop, cacheKey } from '@/utils/cache'

/**
 * 86 汇总 · 未归类回答
 *
 * 每条回答三个动作：新建选项 / 归入已有 / 忽略。
 * 「忽略」不是删除——回答原文留在问卷里，只是不参与这次汇总，
 * 所以这里不做二次确认，误点也能在问卷数据页找回来。
 */
const list = ref<UnclassifiedAnswer[]>([])
const candidates = ref<SummaryCandidate[]>([])
const loading = ref(true)
const loadError = ref(false)
const surveyId = ref('')
/** 未归类总数 / 分页状态：列表一次只取 100 条 */
const total = ref(0)
const cursor = ref<string | null>(null)
const hasMore = ref(false)
const loadingMore = ref(false)

/** 新建选项弹层 */
const newSheet = ref(false)
const newTitle = ref('')
const activeAnswer = ref<UnclassifiedAnswer | null>(null)

/** 归入已有弹层 */
const pickSheet = ref(false)

/** 未归类页快照：回答列表 + 可归入的候选选项 */
interface UnclassifiedSnapshot {
  list: UnclassifiedAnswer[]
  candidates: SummaryCandidate[]
  total: number
  cursor: string | null
  hasMore: boolean
}

/** 新建/归入/忽略都会改动两条列表，写完就作废，下次进来重新拉 */
function invalidate() {
  cacheDrop(cacheKey.summaryUnclassified(surveyId.value))
  cacheDrop(cacheKey.pollSummary(surveyId.value))
}

async function load() {
  const cached = cacheGet<UnclassifiedSnapshot>(cacheKey.summaryUnclassified(surveyId.value))
  if (cached) {
    list.value = cached.list
    candidates.value = cached.candidates
    total.value = cached.total ?? cached.list.length
    cursor.value = cached.cursor ?? null
    hasMore.value = cached.hasMore ?? false
  }
  loading.value = !cached
  loadError.value = false
  if (!surveyId.value) {
    loading.value = false
    loadError.value = true
    return
  }
  try {
    const [u, c] = await Promise.all([
      fetchUnclassified(surveyId.value),
      fetchSummaryCandidates(surveyId.value)
    ])
    list.value = u.list
    total.value = u.total
    cursor.value = u.cursor
    hasMore.value = u.hasMore
    candidates.value = c
    cacheSet(cacheKey.summaryUnclassified(surveyId.value), {
      list: u.list,
      candidates: c,
      total: u.total,
      cursor: u.cursor,
      hasMore: u.hasMore
    })
  } catch {
    if (!cached) loadError.value = true
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!hasMore.value || loadingMore.value || loading.value) return
  loadingMore.value = true
  try {
    const next = await fetchUnclassified(surveyId.value, cursor.value)
    const seen = new Set(list.value.map((x) => x.id))
    list.value = [...list.value, ...next.list.filter((x) => !seen.has(x.id))]
    cursor.value = next.cursor
    hasMore.value = next.hasMore
    total.value = next.total
  } catch {
    uni.showToast({ title: '加载失败，请重试', icon: 'none' })
  } finally {
    loadingMore.value = false
  }
}

onLoad((q) => {
  surveyId.value = (q?.id as string) ?? ''
})
onMounted(load)

function openNew(a: UnclassifiedAnswer) {
  activeAnswer.value = a
  newTitle.value = ''
  newSheet.value = true
}

async function confirmNew() {
  const t = newTitle.value.trim()
  const target = activeAnswer.value
  if (!t || !target) return

  try {
    const { id } = await createSummaryOption(surveyId.value, {
      title: t,
      answerIds: [target.id]
    })
    candidates.value.push({
      id,
      title: t,
      desc: '',
      answerCount: 1,
      sample: target.content
    })
    list.value = list.value.filter((x) => x.id !== target.id)
    total.value = Math.max(0, total.value - 1)
    newSheet.value = false
    invalidate()
    uni.showToast({ title: '已新建选项', icon: 'none' })
  } catch {
    uni.showToast({ title: '新建失败，请重试', icon: 'none' })
  }
}

function openPick(a: UnclassifiedAnswer) {
  activeAnswer.value = a
  pickSheet.value = true
}

async function pickInto(c: SummaryCandidate) {
  const target = activeAnswer.value
  if (!target) return

  try {
    await assignSummaryAnswers(surveyId.value, c.id, [target.id])
    c.answerCount += 1
    list.value = list.value.filter((x) => x.id !== target.id)
    total.value = Math.max(0, total.value - 1)
    pickSheet.value = false
    invalidate()
    uni.showToast({ title: `已归入「${c.title}」`, icon: 'none' })
  } catch {
    uni.showToast({ title: '归类失败，请重试', icon: 'none' })
  }
}

async function ignore(a: UnclassifiedAnswer) {
  try {
    await ignoreSummaryAnswers(surveyId.value, [a.id])
    list.value = list.value.filter((x) => x.id !== a.id)
    total.value = Math.max(0, total.value - 1)
    invalidate()
  } catch {
    uni.showToast({ title: '操作失败，请重试', icon: 'none' })
  }
}

const ignoreAllVisible = ref(false)

function ignoreAll() {
  if (!total.value) return
  ignoreAllVisible.value = true
}

async function doIgnoreAll() {
  ignoreAllVisible.value = false
  try {
    // 让服务端按「全部未归类」处理：只传当前这一页的 id 会漏掉后面的回答
    await ignoreSummaryAnswers(surveyId.value, [], true)
    list.value = []
    total.value = 0
    hasMore.value = false
    cursor.value = null
    invalidate()
  } catch {
    uni.showToast({ title: '操作失败，请重试', icon: 'none' })
  }
}

function goBack() {
  back()
}
</script>

<template>
  <view class="unclassified">
    <AppNavBar title="未归类回答">
      <template #right>
        <text class="unclassified__all" @tap="ignoreAll">全部忽略</text>
      </template>
    </AppNavBar>

    <view v-if="loading" class="unclassified__body">
      <AppSkeleton type="list" />
    </view>

    <AppEmpty
      v-else-if="loadError"
      icon="wifi-off"
      title="未归类回答加载失败"
      desc="网络不太稳定，或者你没有整理这份问卷的权限"
      action="重新加载"
      action-icon="refresh-cw"
      @action="load"
    />

    <template v-else>
      <scroll-view class="unclassified__scroll" scroll-y @scrolltolower="loadMore">
        <view class="unclassified__content">
          <!-- 86 的说明条：$warning-soft r14 pad[12,14] -->
          <view class="intro">
            <view class="intro__icon">
              <AppIcon name="triangle-alert" :size="15" color="#D97706" />
            </view>
            <text class="intro__text">
              {{ total }} 条回答没能归到已有选项，可能是新地点，或者写得太笼统。归成新选项，或直接忽略。
            </text>
          </view>

          <!-- 86：整卡白底，答案之间用通栏细线分隔 -->
          <view v-if="list.length" class="answers">
            <template v-for="(a, i) in list" :key="a.id">
              <view v-if="i > 0" class="answers__sep" />
              <view class="item">
                <view class="item__meta">
                  <text class="item__time">{{ formatRelative(a.createdAt) }}</text>
                </view>

                <text class="item__content">{{ a.content }}</text>

                <view class="item__actions">
                  <view class="act act--new" @tap="openNew(a)">
                    <text class="act__text act__text--new">新建选项</text>
                  </view>
                  <view class="act" @tap="openPick(a)">
                    <text class="act__text">归入已有</text>
                  </view>
                  <view class="act act--plain" @tap="ignore(a)">
                    <text class="act__text act__text--plain">忽略</text>
                  </view>
                </view>
              </view>
            </template>
          </view>

          <text v-if="list.length && loadingMore" class="unclassified__more">加载更多…</text>
          <text v-else-if="list.length && !hasMore" class="unclassified__more">没有更多了</text>

          <AppEmpty
            v-if="!list.length"
            icon="circle-check"
            title="所有回答都归类完了"
            desc="回到选项列表确认一下，就可以进入下一步"
            action="完成 · 回到选项"
            @action="goBack"
          />
        </view>
      </scroll-view>

      <view class="unclassified__actions" :style="{ paddingBottom: bottomInset(20) }">
        <AppButton type="subtle" size="cta" class="unclassified__action" @tap="goBack">返回</AppButton>
        <AppButton size="cta" class="unclassified__action" @tap="goBack">完成 · 回到选项</AppButton>
      </view>
    </template>

    <!-- 新建选项 -->
    <AppSheet
      :visible="newSheet"
      title="新建选项"
      desc="用这条回答起一个选项，标题 ≤12 字"
      @close="newSheet = false"
    >
      <view class="new-form">
        <text class="new-form__label">选项标题</text>
        <view class="new-form__input">
          <input v-model="newTitle" maxlength="12" placeholder="例如：海边 · 看海住一晚" placeholder-class="new-form__ph" />
        </view>
        <text class="new-form__sample">{{ activeAnswer?.content }}</text>
      </view>

      <template #footer>
        <AppButton :disabled="!newTitle.trim()" @tap="confirmNew">新建并归类</AppButton>
      </template>
    </AppSheet>

    <!-- 归入已有 -->
    <AppSheet
      :visible="pickSheet"
      title="归入已有选项"
      desc="选择一条最接近的候选选项"
      @close="pickSheet = false"
    >
      <view class="picker">
        <view v-for="c in candidates" :key="c.id" class="picker__item" @tap="pickInto(c)">
          <view class="picker__text">
            <text class="picker__title">{{ c.title }}</text>
            <text class="picker__desc">{{ c.answerCount }} 条回答</text>
          </view>
          <AppIcon name="chevron-right" :size="14" color="#A1A1AA" />
        </view>
      </view>
    </AppSheet>

    <AppConfirmSheet
      :visible="ignoreAllVisible"
      title="忽略全部未归类回答？"
      desc="这些回答不会进入这次汇总，但原文仍保留在问卷数据里。"
      confirm-text="全部忽略"
      @close="ignoreAllVisible = false"
      @confirm="doIgnoreAll"
    />
  </view>
</template>

<script lang="ts">
export default { name: 'SummaryUnclassifiedPage' }
</script>

<style lang="scss" scoped>
.unclassified {
  /* 定高：scroll-view 需要父级有确定高度，min-height 在真机上会让它塌成 0 高 */
  height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  /* 86 页头右侧「全部忽略」是 14 号灰字 */
  &__all {
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

  &__more {
    padding: 10px 0 2px;
    font-size: 11px;
    color: $faint;
    text-align: center;
  }

  &__actions {
    display: flex;
    gap: 10px;
    /* 下边距由 bottomInset() 内联控制 */
    padding: 8px $gutter 0;
    flex-shrink: 0;
  }

  &__action {
    flex: 1;
    font-size: 15px;
    font-weight: 600;
  }
}

/* 说明条：$warning-soft r14 pad[12,14] gap10，图标装 28 的白底块 */
.intro {
  padding: 12px 14px;
  border-radius: 14px;
  background: $warning-soft;
  display: flex;
  align-items: flex-start;
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
    font-size: 11px;
    color: $muted;
    line-height: 1.55;
  }
}

/* 答案卡：白底 r16，行内边距 [12,16] */
.answers {
  border-radius: 16px;
  background: $surface;
  border: 1px solid $line;
  overflow: hidden;

  &__sep {
    height: 1px;
    background: $line;
  }
}

.item {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;

  &__meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  &__time,
  &__id {
    font-size: 10px;
    color: $faint;
  }

  &__content {
    font-size: 12px;
    color: $ink;
    line-height: 1.55;
  }

  &__actions {
    display: flex;
    gap: 8px;
  }
}

/* 86 的三个操作：r7 pad[5,10]，新建浅紫、归入灰底、忽略透明 */
.act {
  padding: 5px 10px;
  border-radius: 7px;
  background: $subtle;
  display: flex;
  align-items: center;

  &--new {
    background: $accent-soft;
  }

  &--plain {
    background: transparent;
    padding-left: 0;
  }

  &__text {
    font-size: 12px;
    color: $muted;

    &--new {
      color: $accent-ink;
    }

    /* 忽略是白字在浅底上几乎不可见，用和「新建选项」同强度但更淡的灰 */
    &--plain {
      color: $faint;
    }
  }
}

.new-form {
  display: flex;
  flex-direction: column;
  gap: 8px;

  &__label {
    font-size: 12px;
    font-weight: 600;
    color: $ink;
  }

  /* 与 33 弹层输入框同一套：白底 + 1px $line、r12、内边距 12 */
  &__input {
    padding: 12px;
    border-radius: 12px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    font-size: 13px;
    color: $ink;
  }

  &__ph {
    color: $faint;
  }

  &__sample {
    font-size: 11px;
    color: $faint;
    line-height: 1.55;
    padding: 10px 12px;
    border-radius: 10px;
    background: $bg;
  }
}

.picker {
  display: flex;
  flex-direction: column;
  gap: 8px;

  &__item {
    padding: 12px;
    border-radius: 12px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  &__title {
    font-size: 13px;
    font-weight: 600;
    color: $ink;
  }

  &__desc {
    font-size: 11px;
    color: $faint;
  }
}
</style>
