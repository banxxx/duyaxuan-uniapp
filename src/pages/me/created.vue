<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app'
import type { Poll } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import AppTabBar from '@/components/base/AppTabBar.vue'
import StatsCard from '@/components/business/StatsCard.vue'
import FilterChips from '@/components/business/FilterChips.vue'
import PollRow from '@/components/business/PollRow.vue'
import SwipeRow from '@/components/business/SwipeRow.vue'
import { fetchMyPolls, fetchStats, deletePoll, restorePoll } from '@/api/poll'
import { formatRemaining } from '@/utils/format'
import { getSafeArea, bottomInset } from '@/utils/platform'
import { takePendingUndo } from '@/utils/delete-undo'
import { ROUTES, go } from '@/utils/router'
import { cacheGet, cacheSet, cacheDrop, cacheKey } from '@/utils/cache'
import AppToast from '@/components/base/AppToast.vue'
import { toast } from '@/utils/toast'

/**
 * 41 我发起的 + 88 左滑操作 + 89 更多操作 + 96 删除撤销
 *
 * 四个设计稿页面合成一个页面：
 *   列表常态       → 41
 *   左滑露出操作   → 88（SwipeRow 手势）
 *   点「···」      → 89（ActionSheet）
 *   删除后         → 96（底部提示条 + 5 秒撤销）
 */
const filters = [
  { value: 'all', label: '全部' },
  { value: 'ongoing', label: '进行中' },
  { value: 'ended', label: '已结束' }
]

const status = ref<'all' | 'ongoing' | 'ended'>('all')
const list = ref<Poll[]>([])
const stats = ref<Array<{ value: string | number; label: string }>>([])
const loading = ref(false)
/** 首屏加载失败：没有缓存内容时换成错误页，不能让用户对着空列表以为「真没有」 */
const loadError = ref(false)
const cursor = ref<string | null>(null)
const hasMore = ref(true)

/** 底部小横条高度，用于撤销条与 tab 占位 */
const { safeBottom } = getSafeArea()

// 操作面板（89）
const sheetVisible = ref(false)
const activePoll = ref<Poll | null>(null)

// 删除确认（92/95）
const confirmVisible = ref(false)

/**
 * 删除确认的正文：进行中 / 已结束 / 还没人参与，三种情况说清楚后果。
 * 入口在列表和详情页两处，文案保持一致的政策：随时可删、立刻下线、5 秒内可撤销。
 */
const deleteDesc = computed(() => {
  const p = activePoll.value
  if (!p) return ''
  const isSurvey = p.type === 'survey'
  const ongoing = p.rules.endAt > Date.now()
  const people = isSurvey ? `${p.answerCount ?? 0} 条回答` : `${p.voterCount ?? 0} 人投票`
  const comments = `${p.commentCount ?? 0} 条评论`
  const undo = '5 秒内可在底部提示里撤销，之后无法恢复。'
  if (!(isSurvey ? p.answerCount : p.voterCount)) {
    return `还没有人参与。删除后立即从列表和分享链接下线，${undo}`
  }
  if (ongoing) {
    return `「${p.title}」还在进行中，已有 ${people}、${comments}。删除后立即从列表和分享链接下线，参与者再打开会看到「已被删除」；${undo}`
  }
  return `「${p.title}」已结束，已有 ${people}、${comments}。删除后结果页和分享链接都会失效；${undo}`
})

// 撤销提示条（96）
const toastVisible = ref(false)
const toastText = ref('')
let undoPoll: Poll | null = null
let undoTimer: ReturnType<typeof setTimeout> | null = null

/** 列表快照：第一页 + 顶部统计。翻页不缓存，重进页面重新翻也不慢 */
interface ListSnapshot {
  list: Poll[]
  cursor: string | null
  hasMore: boolean
  stats: Array<{ value: string | number; label: string }>
}

function saveSnapshot() {
  cacheSet(cacheKey.pollList('mine', status.value), {
    list: list.value,
    cursor: cursor.value,
    hasMore: hasMore.value,
    stats: stats.value
  })
}

/** 切筛选时先铺对应缓存，没有就清空列表、交给骨架屏 */
function seed(v: string) {
  const cached = cacheGet<ListSnapshot>(cacheKey.pollList('mine', v))
  list.value = cached?.list ?? []
  cursor.value = cached?.cursor ?? null
  hasMore.value = cached?.hasMore ?? true
  if (cached) stats.value = cached.stats
}

/** 正在请求时又要求刷新（比如撤销删除），等当前请求结束再补一次，不能直接吞掉 */
let reloadQueued = false

async function load(reset = false) {
  if (loading.value) {
    if (reset) reloadQueued = true
    return
  }
  loading.value = true
  loadError.value = false
  try {
    if (reset) {
      cursor.value = null
      hasMore.value = true
    }
    const res = await fetchMyPolls(status.value, cursor.value)
    list.value = reset ? res.list : [...list.value, ...res.list]
    cursor.value = res.cursor
    hasMore.value = res.hasMore
  } catch {
    // 已有内容（翻页失败）就保留旧列表，只有首屏空白时才整页报错
    if (!list.value.length) loadError.value = true
  } finally {
    loading.value = false
    if (reloadQueued) {
      reloadQueued = false
      load(true).then(saveSnapshot).catch(() => {})
    }
  }
}

async function loadStats() {
  // 顶部统计失败不影响列表：保留旧值（首次就是空），不把整个页面拖成错误态
  try {
    stats.value = await fetchStats()
  } catch {
    /* 静默 */
  }
}

onMounted(async () => {
  seed(status.value)
  await Promise.all([load(true), loadStats()])
  saveSnapshot()
})

/**
 * 从详情页删除后退回来：详情页把刚删掉的投票放在 delete-undo 里交接，
 * 在这里显示同一条撤销条；否则用户只有列表删除才有 5 秒反悔机会。
 *
 * 首次 show 紧跟 onMounted，不重复拉；从详情/编辑页回来则要重拉，
 * 否则删除、改名、提前结束都还停在旧数据上。
 */
let firstShow = true
onShow(async () => {
  const pending = takePendingUndo()
  if (pending) showUndo(pending)
  if (firstShow) {
    firstShow = false
    return
  }
  await load(true)
  saveSnapshot()
})

onPullDownRefresh(async () => {
  await Promise.all([load(true), loadStats()])
  saveSnapshot()
  uni.stopPullDownRefresh()
})

onReachBottom(() => {
  if (hasMore.value && !loading.value) load()
})

function onFilter(v: string) {
  status.value = v as typeof status.value
  seed(v)
  load(true).then(saveSnapshot)
}

function openDetail(poll: Poll) {
  go(ROUTES.detail, { id: poll.id })
}

/** 89：底部操作面板 */
function openSheet(poll: Poll) {
  activePoll.value = poll
  sheetVisible.value = true
}

/** 编辑只有「内容」和「规则」两页，问卷和投票共用同一套页面，靠 type 分流渲染 */
function goEdit(poll: Poll) {
  sheetVisible.value = false
  go(ROUTES.creatorEditContent, { id: poll.id })
}

function goCreate() {
  go(ROUTES.createType)
}

function askDelete(poll: Poll) {
  sheetVisible.value = false
  activePoll.value = poll
  confirmVisible.value = true
}

/** 96：显示撤销条，5 秒后自动收起 */
function showUndo(poll: Poll) {
  undoPoll = poll
  toastText.value = `已删除「${poll.title}」`
  toastVisible.value = true
  if (undoTimer) clearTimeout(undoTimer)
  undoTimer = setTimeout(() => {
    toastVisible.value = false
    undoPoll = null
  }, 5000)
}

async function confirmDelete() {
  const poll = activePoll.value
  if (!poll) return
  confirmVisible.value = false

  // 先本地移除，界面立刻响应；失败再放回去
  const index = list.value.findIndex((p) => p.id === poll.id)
  if (index >= 0) list.value.splice(index, 1)

  try {
    await deletePoll(poll.id)
    // 三个筛选条件下的列表缓存都失效了，下次进来重新拉
    cacheDrop('list:mine')
    showUndo(poll)
  } catch {
    if (index >= 0) list.value.splice(index, 0, poll)
    // 失败原因由请求层统一 toast，这里不再重复
  }
}

/** 96：5 秒内撤销 */
async function undoDelete() {
  const poll = undoPoll
  if (!poll) return
  if (undoTimer) clearTimeout(undoTimer)
  toastVisible.value = false
  undoPoll = null
  try {
    await restorePoll(poll.id)
    await load(true)
    saveSnapshot()
  } catch {
    toast.error('撤销失败，已超出可撤销时间')
  }
}

function onSwipeEdit(poll: Poll) {
  goEdit(poll)
}

function onSwipeDelete(poll: Poll) {
  askDelete(poll)
}
</script>

<template>
  <view class="page">
    <AppToast />
    <AppNavBar title="我发起的" :back="true" />

    <view class="page__content">
      <StatsCard v-if="stats.length" :items="stats" />
      <FilterChips :model-value="status" :options="filters" @update:model-value="onFilter" />

      <view class="page__list">
        <SwipeRow
          v-for="(poll, i) in list"
          :key="poll.id"
          class="anim anim--fade-up"
          :style="{ animationDelay: `${Math.min(i, 8) * 40}ms` }"
          @edit="onSwipeEdit(poll)"
          @delete="onSwipeDelete(poll)"
          @tap="openDetail(poll)"
        >
          <PollRow :poll="poll" manage @tap="openDetail(poll)" @more="openSheet(poll)" />
        </SwipeRow>

        <AppEmpty
          v-if="!loading && loadError && !list.length"
          icon="wifi-off"
          title="加载失败"
          desc="网络不太稳定，或者服务暂时不可用，稍后再试"
          action="重新加载"
          action-icon="refresh-cw"
          @action="load(true)"
        />

        <AppEmpty
          v-else-if="!loading && !list.length"
          icon="inbox"
          title="还没有发起过投票"
          desc="点底部的「+」发起第一场，三步就能完成"
          action="去创建"
          @action="goCreate"
        />

        <!-- 只有真的没内容时才铺骨架：刷新时列表已经在，不需要再占一次屏 -->
        <view v-if="loading && !list.length" class="page__loading">
          <AppSkeleton type="list" flush />
        </view>
      </view>
    </view>

    <!-- 89 更多操作 -->
    <view v-if="sheetVisible" class="sheet" @tap="sheetVisible = false">
      <view class="sheet__panel" :style="{ paddingBottom: bottomInset(24) }" @tap.stop>
        <view class="sheet__handle"><view class="sheet__bar" /></view>
        <view class="sheet__head">
          <text class="sheet__title">{{ activePoll?.title }}</text>
          <text class="sheet__desc">
            {{ activePoll?.type === 'survey' ? '问卷' : activePoll?.type === 'multiple' ? '多选' : '单选' }}
            · {{ activePoll && activePoll.rules.endAt > Date.now() ? '进行中' : '已结束' }}
            <template v-if="activePoll && activePoll.rules.endAt > Date.now()">
               · {{ formatRemaining(activePoll.rules.endAt) }}
            </template>
          </text>
        </view>

        <view class="sheet__actions">
          <view class="sheet__item" hover-class="sheet__item--active" @tap="activePoll && goEdit(activePoll)">
            <AppIcon name="square-pen" :size="18" color="#09090B" />
            <text class="sheet__item-text">编辑{{ activePoll?.type === 'survey' ? '问卷' : '投票' }}</text>
          </view>
          <view class="sheet__sep" />
          <view class="sheet__item" hover-class="sheet__item--active" @tap="activePoll && askDelete(activePoll)">
            <AppIcon name="trash-2" :size="18" color="#DC2626" />
            <text class="sheet__item-text sheet__item-text--danger">
              删除{{ activePoll?.type === 'survey' ? '问卷' : '投票' }}
            </text>
          </view>
        </view>

        <view class="sheet__cancel" hover-class="sheet__item--active" @tap="sheetVisible = false">
          <text class="sheet__cancel-text">取消</text>
        </view>
      </view>
    </view>

    <!-- 92/95 删除确认 -->
    <view v-if="confirmVisible" class="sheet" @tap="confirmVisible = false">
      <view class="confirm" :style="{ paddingBottom: bottomInset(24) }" @tap.stop>
        <view class="confirm__handle"><view class="confirm__bar" /></view>
        <view class="confirm__head">
          <text class="confirm__title">
            删除这{{ activePoll?.type === 'survey' ? '份问卷' : '场投票' }}？
          </text>
          <text class="confirm__desc">{{ deleteDesc }}</text>
        </view>
        <view class="confirm__buttons">
          <view class="confirm__btn confirm__btn--cancel" @tap="confirmVisible = false">
            <text class="confirm__btn-text">取消</text>
          </view>
          <view class="confirm__btn confirm__btn--danger" @tap="confirmDelete">
            <text class="confirm__btn-text confirm__btn-text--light">
              删除{{ activePoll?.type === 'survey' ? '问卷' : '投票' }}
            </text>
          </view>
        </view>
      </view>
    </view>

    <!-- 96 撤销提示条 -->
    <view v-if="toastVisible" class="toast" :style="{ bottom: `calc(76px + ${safeBottom}px)` }">
      <text class="toast__text">{{ toastText }}</text>
      <text class="toast__undo" @tap="undoDelete">撤销</text>
    </view>

    <AppTabBar current="me" />
    <view class="page__tabspace" :style="{ height: `calc(64px + ${safeBottom}px)` }" />
  </view>
</template>

<script lang="ts">
export default { name: 'CreatedPollsPage' }
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  /* #ifdef H5 */
  min-height: 100dvh;
  /* #endif */
  background: $bg;
  display: flex;
  flex-direction: column;

  &__content {
    flex: 1;
    padding: 8px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  &__loading {
    padding: 20px 0;
  }

  &__tabspace {
    /* 高度由内联 style 按 safeBottom 给 */
  }
}

/* 底部弹层通用 */
.sheet {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: flex-end;

  /* 遮罩与面板分两层，遮罩只淡入、面板只上滑 */
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: rgba(9, 9, 11, 0.4);
    animation: dyx-mask-in $dur-base $ease-out both;
  }

  &__panel {
    position: relative;
    width: 100%;
    background: $surface;
    border-radius: $r-sheet $r-sheet 0 0;
    /* 下边距由内联 bottomInset(24) 给 */
    padding: 10px $gutter 24px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    animation: dyx-sheet-up $dur-base $ease-out both;
  }

  &__handle {
    height: 4px;
    display: flex;
    justify-content: center;
  }

  &__bar {
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: $line;
  }

  &__head {
    padding: 8px 0 4px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__title {
    font-size: $fs-15;
    font-weight: 600;
    color: $ink;
  }

  &__desc {
    font-size: $fs-11;
    color: $faint;
  }

  &__actions {
    background: $subtle;
    border-radius: $r-input;
    overflow: hidden;
  }

  &__item {
    height: 52px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 12px;

    &--active {
      background: $line;
    }
  }

  &__item-text {
    font-size: $fs-14;
    color: $ink;

    &--danger {
      color: $danger;
    }
  }

  &__sep {
    height: 1px;
    background: $line;
    margin-left: 16px;
  }

  &__cancel {
    height: 50px;
    border-radius: $r-input;
    background: $subtle;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__cancel-text {
    font-size: $fs-15;
    font-weight: 600;
    color: $ink;
  }
}

/* 删除确认面板 */
.confirm {
  position: relative;
  width: 100%;
  background: $surface;
  border-radius: $r-sheet $r-sheet 0 0;
  /* 下边距由内联 bottomInset(24) 给 */
  padding: 10px $gutter 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  animation: dyx-sheet-up $dur-base $ease-out both;

  &__handle {
    height: 4px;
    display: flex;
    justify-content: center;
  }

  &__bar {
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: $line;
  }

  &__head {
    padding-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__title {
    font-size: $fs-17;
    font-weight: 600;
    color: $ink;
  }

  &__desc {
    font-size: $fs-12;
    color: $muted;
    line-height: 1.55;
  }

  &__buttons {
    display: flex;
    gap: 10px;
  }

  &__btn {
    flex: 1;
    height: 50px;
    border-radius: $r-input;
    display: flex;
    align-items: center;
    justify-content: center;

    &--cancel {
      background: $subtle;
    }

    &--danger {
      background: $danger;
    }
  }

  &__btn-text {
    font-size: $fs-15;
    font-weight: 600;
    color: $ink;

    &--light {
      color: $white;
    }
  }
}

/* 撤销提示条 */
.toast {
  position: fixed;
  left: $gutter;
  right: $gutter;
  /* bottom 由内联 style 按 safeBottom 给 */
  height: 52px;
  padding: 0 16px;
  border-radius: $r-input;
  background: $ink;
  display: flex;
  align-items: center;
  justify-content: space-between;
  z-index: 210;
  /* 从底部浮上来，比直接闪现更容易被注意到 */
  animation: dyx-fade-up $dur-base $ease-out both;

  &__text {
    font-size: $fs-13;
    font-weight: 500;
    color: $white;
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &__undo {
    font-size: $fs-13;
    font-weight: 600;
    color: $accent-200;
    padding-left: 12px;
    flex-shrink: 0;
  }
}
</style>
