<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { onPullDownRefresh, onReachBottom } from '@dcloudio/uni-app'
import type { Poll } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppTabBar from '@/components/base/AppTabBar.vue'
import PollRow from '@/components/business/PollRow.vue'
import { fetchJoinedPolls } from '@/api/poll'
import { getSafeArea } from '@/utils/platform'
import { ROUTES, go, switchTab } from '@/utils/router'
import { cacheGet, cacheSet, cacheKey } from '@/utils/cache'

/**
 * 42 我参与的
 *
 * 和 41 的区别：这是纯浏览列表，行尾是「›」不是「···」，
 * 别人的投票不该在我的列表里管理。每行额外显示「你投了…」。
 *
 * 筛选用的是整行宽的分段控件（$subtle 轨道 + 白色选中块），
 * 不是 41 那种胶囊 —— 设计稿两页刻意区分：自己管理的列表用胶囊，
 * 浏览用的列表用分段，密度和样式都不一样。
 */
const filters = [
  { value: 'all', label: '全部' },
  { value: 'ongoing', label: '进行中' },
  { value: 'ended', label: '已结束' }
]

const status = ref<'all' | 'ongoing' | 'ended'>('all')
const list = ref<Poll[]>([])
const loading = ref(false)
const cursor = ref<string | null>(null)
const hasMore = ref(true)

const { safeBottom } = getSafeArea()

/** 列表快照：只存第一页，再进页面先看到内容，翻页仍然重新请求 */
interface ListSnapshot {
  list: Poll[]
  cursor: string | null
  hasMore: boolean
}

/** 换了筛选条件时先把对应缓存铺上，没有就清空列表走加载态 */
function seed(v: string) {
  const cached = cacheGet<ListSnapshot>(cacheKey.pollList('joined', v))
  list.value = cached?.list ?? []
  cursor.value = cached?.cursor ?? null
  hasMore.value = cached?.hasMore ?? true
}

async function load(reset = false) {
  if (loading.value) return
  loading.value = true
  try {
    if (reset) {
      cursor.value = null
      hasMore.value = true
    }
    const res = await fetchJoinedPolls(status.value, cursor.value)
    list.value = reset ? res.list : [...list.value, ...res.list]
    cursor.value = res.cursor
    hasMore.value = res.hasMore
    if (reset) {
      cacheSet(cacheKey.pollList('joined', status.value), {
        list: res.list,
        cursor: res.cursor,
        hasMore: res.hasMore
      })
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  seed(status.value)
  load(true)
})
onPullDownRefresh(async () => {
  await load(true)
  uni.stopPullDownRefresh()
})
onReachBottom(() => {
  if (hasMore.value && !loading.value) load()
})

function onFilter(v: string) {
  status.value = v as typeof status.value
  seed(v)
  load(true)
}

function openDetail(poll: Poll) {
  go(ROUTES.detail, { id: poll.id })
}

/** 42 导航右上角是「···」：只有筛状态这类全局动作，不做行级管理 */
function openMore() {
  uni.showActionSheet({
    itemList: ['只看进行中', '只看已结束', '查看全部'],
    success: (r) => {
      status.value = (['ongoing', 'ended', 'all'] as const)[r.tapIndex]
      load(true)
    }
  })
}

/** 空状态没有「发起」，回首页让用户自己挑一条参与 */
function goHome() {
  switchTab(ROUTES.home)
}
</script>

<template>
  <view class="page">
    <AppNavBar title="我参与的">
      <template #right>
        <view class="page__more" @tap="openMore">
          <AppIcon name="ellipsis" :size="17" color="#09090B" />
        </view>
      </template>
    </AppNavBar>

    <view class="page__content">
      <view class="segments">
        <view
          v-for="f in filters"
          :key="f.value"
          class="segments__item"
          :class="{ 'segments__item--on': status === f.value }"
          @tap="onFilter(f.value)"
        >
          <text class="segments__text" :class="{ 'segments__text--on': status === f.value }">
            {{ f.label }}
          </text>
        </view>
      </view>

      <view class="page__list">
        <PollRow
          v-for="(poll, i) in list"
          :key="poll.id"
          class="anim anim--fade-up"
          :style="{ animationDelay: `${Math.min(i, 8) * 40}ms` }"
          :poll="poll"
          show-my-choice
          @tap="openDetail(poll)"
        />

        <AppEmpty
          v-if="!loading && !list.length"
          icon="inbox"
          title="还没有参与过投票"
          desc="去发现页看看大家发起的投票吧"
          action="去发现"
          @action="goHome"
        />
      </view>
    </view>

    <AppTabBar current="me" />
    <view class="page__tabspace" :style="{ height: `calc(64px + ${safeBottom}px)` }" />
  </view>
</template>

<script lang="ts">
export default { name: 'JoinedPollsPage' }
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
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

  &__more {
    width: 34px;
    height: 34px;
    border-radius: 17px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  &__tabspace {
    /* 高度由内联 style 按 safeBottom 给 */
  }
}

/* 42 的分段控件：整行宽、$subtle 轨道 + 白色选中块（与 15/26/44 同一套） */
.segments {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: $subtle;

  &__item {
    flex: 1;
    padding: 8px 0;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;

    &--on {
      background: $surface;
    }
  }

  &__text {
    font-size: 12px;
    font-weight: 500;
    color: $muted;

    &--on {
      color: $ink;
      font-weight: 600;
    }
  }
}
</style>
