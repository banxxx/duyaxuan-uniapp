<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { onPullDownRefresh, onReachBottom } from '@dcloudio/uni-app'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import AppTabBar from '@/components/base/AppTabBar.vue'
import PendingCard from '@/components/business/PendingCard.vue'
import { fetchPendingPolls } from '@/api/poll'
import type { PendingPoll } from '@/mock/data'
import { getSafeArea } from '@/utils/platform'
import { ROUTES, go, switchTab } from '@/utils/router'
import AppToast from '@/components/base/AppToast.vue'

/**
 * 待我投票 · 全部
 *
 * 首页只展示前 5 条，这里把「别人邀请我、我还没参与」的投票和问卷全部列出来。
 * 接口按 limit/offset 分批返回，滚到底再取下一页；返回条数不足一页就算到底。
 */
const PAGE_SIZE = 50

const list = ref<PendingPoll[]>([])
const loading = ref(false)
const error = ref(false)
const cursor = ref<string | null>(null)
const hasMore = ref(true)

const { safeBottom } = getSafeArea()

async function load(reset = false) {
  if (loading.value) return
  loading.value = true
  error.value = false
  try {
    if (reset) {
      list.value = []
      cursor.value = null
      hasMore.value = true
    }
    const page = await fetchPendingPolls(PAGE_SIZE, cursor.value)
    // 游标分页基本不会重复，这里再按 id 兜一次底
    const seen = new Set(list.value.map((p) => p.id))
    list.value = [...list.value, ...page.list.filter((p) => !seen.has(p.id))]
    cursor.value = page.cursor
    hasMore.value = page.hasMore
  } catch {
    if (!list.value.length) error.value = true
    hasMore.value = false
  } finally {
    loading.value = false
  }
}

onMounted(() => load(true))
onPullDownRefresh(async () => {
  await load(true)
  uni.stopPullDownRefresh()
})
onReachBottom(() => {
  if (hasMore.value && !loading.value) load()
})

function openDetail(poll: PendingPoll) {
  go(ROUTES.detail, { id: poll.id })
}

function goHome() {
  switchTab(ROUTES.home)
}
</script>

<template>
  <view class="page">
    <AppToast />
    <AppNavBar title="待我投票" />

    <view class="page__content">
      <view v-if="error" class="page__body">
        <AppEmpty
          icon="wifi-off"
          title="网络连接失败"
          desc="请检查网络设置后重试，或稍后再试"
          action="重新加载"
          action-icon="refresh-cw"
          @action="load(true)"
        />
      </view>

      <view v-else-if="loading && !list.length" class="page__body">
        <AppSkeleton type="cards" flush />
      </view>

      <view v-else-if="!list.length" class="page__body">
        <AppEmpty
          icon="inbox"
          title="暂时没有需要你参与的"
          desc="当有人邀请你投票或填写问卷时，会出现在这里"
          action="回首页"
          @action="goHome"
        />
      </view>

      <view v-else class="page__list">
        <PendingCard
          v-for="(poll, i) in list"
          :key="poll.id"
          class="anim anim--fade-up"
          :style="{ animationDelay: `${Math.min(i, 8) * 40}ms` }"
          :poll="poll"
          @tap="openDetail(poll)"
          @vote="openDetail(poll)"
        />
        <text v-if="loading" class="page__more">加载中…</text>
        <text v-else-if="!hasMore" class="page__more">没有更多了</text>
      </view>
    </view>

    <AppTabBar current="me" />
    <view class="page__tabspace" :style="{ height: `calc(64px + ${safeBottom}px)` }" />
  </view>
</template>

<script lang="ts">
export default { name: 'PendingPollsPage' }
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
  }

  &__body {
    flex: 1;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  &__more {
    padding: 14px 0 4px;
    font-size: $fs-11;
    color: $faint;
    text-align: center;
  }

  &__tabspace {
    /* 高度由内联 style 按 safeBottom 给 */
  }
}
</style>
