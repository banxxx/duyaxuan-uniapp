<template>
  <view class="home" :style="{ paddingTop: `${contentTop}px` }">
    <view class="home__content">
      <!-- Header：问候 + 铃铛 + 头像（设计稿 02：Greeting 宽度自适应，不参与撑满） -->
      <view class="home__header">
        <view class="home__greeting">
          <text class="home__date">{{ today }}</text>
          <text class="home__title">我的投票</text>
        </view>

        <!-- 整块内容已经落在胶囊下沿以下，右上角按钮不会再被盖住 -->
        <view class="home__actions">
          <view class="home__bell" hover-class="home__icon--active" @tap="openNotifications">
            <AppIcon name="bell" :size="18" color="#09090B" />
            <view v-if="pending.length" class="home__dot" />
          </view>
          <view class="home__avatar" @tap="openMe">
            <AppAvatar :src="user.profile?.avatar" :name="avatarName" :size="44" />
          </view>
        </view>
      </view>
      <!-- 搜索入口 -->
      <view class="home__search" hover-class="home__search--active" @tap="openSearch">
        <AppIcon name="search" :size="18" color="#A1A1AA" />
        <text class="home__search-text">搜索投票或问卷</text>
      </view>

      <!-- 61 网络错误：整页换成错误态，下拉可重试 -->
      <view v-if="error" class="home__body">
        <AppEmpty
          icon="wifi-off"
          title="网络连接失败"
          desc="请检查网络设置后重试，或稍后再试"
          action="重新加载"
          action-icon="refresh-cw"
          @action="load"
        />
      </view>

      <template v-else>
        <!-- 待我投票 -->
        <view class="home__section">
          <view class="home__head">
            <view class="home__head-left">
              <text class="home__section-title">待我投票</text>
              <view v-if="pending.length" class="home__count">
                <text class="home__count-text">{{ pending.length }}</text>
              </view>
            </view>
            <text class="home__all" @tap="openMine">全部</text>
          </view>

          <!-- 60 加载：骨架屏替代转圈 -->
          <view v-if="loading" class="home__loading">
            <AppSkeleton type="cards" />
          </view>

          <!-- 03 空状态：待我投票为空时换成空状态块 -->
          <view v-else-if="!pending.length" class="home__blank">
            <view class="home__blank-icon">
              <AppIcon name="inbox" :size="38" color="#A1A1AA" :stroke-width="1.5" />
            </view>
            <text class="home__blank-title">暂时没有需要你投票的</text>
            <text class="home__blank-desc">当有人邀请你参与投票时，会出现在这里</text>
            <view class="home__blank-btn" hover-class="home__blank-btn--active" @tap="openCreate">
              <AppIcon name="plus" :size="15" color="#FFFFFF" :stroke-width="2" />
              <text class="home__blank-btn-text">发起一个投票</text>
            </view>
          </view>

          <view v-else class="home__cards">
            <PendingCard
              v-for="p in pending"
              :key="p.id"
              :poll="p"
              @tap="openDetail(p.id)"
              @vote="openDetail(p.id)"
            />
          </view>
        </view>

        <!-- 我发起的（设计稿：单列整宽行，不是两列网格） -->
        <view v-if="mine.length" class="home__section">
          <view class="home__head">
            <text class="home__section-title">我发起的</text>
            <text class="home__all" @tap="openMine">全部 {{ mineTotal }} 个</text>
          </view>

          <view class="home__mine">
            <view
              v-for="poll in mine"
              :key="poll.id"
              class="mine-row"
              hover-class="mine-row--active"
              @tap="openDetail(poll.id)"
            >
              <view class="mine-row__title-line">
                <text class="mine-row__title">{{ poll.title }}</text>
                <AppIcon name="chevron-right" :size="15" color="#A1A1AA" />
              </view>
              <view class="mine-row__foot">
                <view class="mine-row__left">
                  <view class="mine-row__status">
                    <view
                      class="mine-row__dot"
                      :class="{ 'mine-row__dot--on': isOngoing(poll) }"
                    />
                    <text
                      class="mine-row__status-text"
                      :class="{ 'mine-row__status-text--on': isOngoing(poll) }"
                    >
                      {{ isOngoing(poll) ? '进行中' : '已结束' }}
                    </text>
                  </view>
                  <text class="mine-row__votes">
                    {{ poll.type === 'survey' ? `${poll.answerCount ?? 0} 条` : `${poll.voterCount} 票` }}
                  </text>
                </view>
                <text class="mine-row__time">
                  {{ isOngoing(poll) ? formatRemaining(poll.rules.endAt) : formatDate(poll.rules.endAt) }}
                </text>
              </view>
            </view>
          </view>
        </view>
      </template>
    </view>

    <view class="home__tabspace" :style="{ height: `calc(64px + ${safeBottom}px)` }" />
    <AppTabBar current="discover" />
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import type { Poll } from '@/types/api'
import AppIcon from '@/components/base/AppIcon.vue'
import AppAvatar from '@/components/base/AppAvatar.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import AppTabBar from '@/components/base/AppTabBar.vue'
import PendingCard from '@/components/business/PendingCard.vue'
import { fetchPendingPolls, fetchMyPolls } from '@/api/poll'
import type { PendingPoll } from '@/mock/data'
import { useUserStore } from '@/stores/user'
import { getSafeArea } from '@/utils/platform'
import { hideNativeTabBar, switchTab, TAB_ME } from '@/utils/tab'
import { formatDate, formatRemaining } from '@/utils/format'

/**
 * 02 首页 · 待我投票（含 03 空状态、60 加载、61 网络错误）
 *
 * 这一页只回答一个问题：现在有什么需要我做的。
 * 所以上半屏是「待我投票」的大卡（谁邀请我、剩多久、去投票），
 * 下半屏是「我发起的」单列紧凑行，只用来扫一眼自己那几场投票的状态。
 *
 * 布局对齐设计稿 02：整页是一条竖向流（gap 18、padding [8,20,18,20]），
 * 不再给每个区块单独加 padding —— 那样区块间距会变成 22+12，和设计稿差一倍。
 */
const user = useUserStore()

const { contentTop, safeBottom } = getSafeArea()

const pending = ref<PendingPoll[]>([])
const mine = ref<Poll[]>([])
/** 设计稿「全部 13 个」是总数，不是当前显示条数 */
const mineTotal = ref(0)
const loading = ref(true)
const error = ref(false)

const today = computed(() => {
  const d = new Date()
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  return formatDate(d.getTime()) + ' ' + week
})

const avatarName = computed(() => user.profile?.nickname ?? '林')

function isOngoing(poll: Poll) {
  return poll.rules.endAt > Date.now()
}

async function load() {
  loading.value = true
  error.value = false
  try {
    const [p, m] = await Promise.all([fetchPendingPolls(), fetchMyPolls('all')])
    pending.value = p
    mine.value = m.list.slice(0, 4)
    mineTotal.value = m.total ?? m.list.length
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)

/** H5 端会渲染原生 tabBar，进来就藏掉（微信端 custom=true，没有原生栏，静默失败） */
onShow(hideNativeTabBar)

onPullDownRefresh(async () => {
  await load()
  uni.stopPullDownRefresh()
})

function openDetail(id: string) {
  uni.navigateTo({ url: `/pages/detail/index?id=${id}` })
}

function openSearch() {
  uni.navigateTo({ url: '/pages/search/index' })
}

function openNotifications() {
  uni.navigateTo({ url: '/pages/settings/notifications' })
}

function openMine() {
  uni.navigateTo({ url: '/pages/me/created' })
}

/** 头像 → 40 我的（switchTab 复用页面实例，不重建、不闪） */
function openMe() {
  switchTab(TAB_ME)
}

function openCreate() {
  uni.navigateTo({ url: '/pages/create/type' })
}
</script>

<script lang="ts">
export default { name: 'HomePage' }
</script>

<style lang="scss" scoped>
.home {
  min-height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  /* 设计稿 Content：竖向流，gap 18，padding [8,20,18,20] */
  &__content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 8px $gutter 18px;
  }

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  &__greeting {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  &__date {
    font-size: 11px;
    color: $faint;
  }

  &__title {
    font-size: 28px;
    font-weight: 700;
    color: $ink;
    line-height: 1.25;
  }

  /* 铃铛 + 头像：右内边距由胶囊位置动态给，窄屏也不会被盖住 */
  &__actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  &__bell {
    width: 40px;
    height: 40px;
    border-radius: 20px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }

  &__icon--active {
    opacity: 0.7;
  }

  &__dot {
    position: absolute;
    top: 8px;
    right: 10px;
    width: 8px;
    height: 8px;
    border-radius: 4px;
    background: $danger;
    border: 1.5px solid $surface;
  }

  &__search {
    height: 46px;
    padding: 0 14px;
    border-radius: 12px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    gap: 10px;

    &--active {
      background: $subtle;
    }
  }

  &__search-text {
    font-size: 14px;
    color: $faint;
  }

  &__body {
    flex: 1;
  }

  /* 设计稿 Section：竖向流 gap 10，自身不加外边距 */
  &__section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__head-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__section-title {
    font-size: 17px;
    font-weight: 700;
    color: $ink;
  }

  /* 设计稿 Count：$accent 底、圆角 9、padding [2,8]、字 11/700 */
  &__count {
    min-width: 18px;
    height: 18px;
    padding: 0 8px;
    border-radius: 9px;
    background: $accent;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__count-text {
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    line-height: 1;
    font-family: $font-num;
  }

  &__all {
    font-size: 12px;
    color: $muted;
  }

  &__loading {
    padding: 8px 0;
  }

  /* 03 空状态：88 图标块 + 18 标题 + 13 说明 + 主按钮 */
  &__blank {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 24px 8px 8px;
  }

  &__blank-icon {
    width: 88px;
    height: 88px;
    border-radius: 24px;
    background: $subtle;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__blank-title {
    margin-top: 20px;
    font-size: 18px;
    font-weight: 700;
    color: $ink;
  }

  &__blank-desc {
    width: 260px;
    margin-top: 10px;
    font-size: 13px;
    color: $muted;
    text-align: center;
    line-height: 1.6;
  }

  &__blank-btn {
    margin-top: 20px;
    height: 42px;
    padding: 0 22px;
    border-radius: 12px;
    background: $accent;
    display: flex;
    align-items: center;
    gap: 7px;

    &--active {
      opacity: 0.85;
    }
  }

  &__blank-btn-text {
    font-size: 13px;
    font-weight: 600;
    color: #fff;
  }

  &__cards {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  &__mine {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* 设计稿 Tab Space 只是 1px 占位，真正的 64 由固定 Tab Bar 覆盖，内容自行留出高度 */
  &__tabspace {
    /* 高度由内联 style 按 safeBottom 给 */
  }
}

/* 单列整宽行：设计稿 Mine Row width=fill_container */
.mine-row {
  padding: 14px;
  background: $surface;
  border: 1px solid $line;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;

  &--active {
    background: $subtle;
  }

  &__title-line {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__title {
    flex: 1;
    font-size: 14px;
    font-weight: 600;
    color: $ink;
    line-height: 1.4;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  /* 设计稿 L：状态组与票数之间 10 */
  &__left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  &__status {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }

  &__dot {
    width: 5px;
    height: 5px;
    border-radius: 3px;
    background: $faint;

    &--on {
      background: $success;
    }
  }

  &__status-text {
    font-size: 10px;
    font-weight: 600;
    color: $faint;

    &--on {
      color: $success;
    }
  }

  &__votes {
    font-size: 10px;
    color: $faint;
  }

  &__time {
    font-size: 10px;
    color: $faint;
    flex-shrink: 0;
  }
}
</style>
