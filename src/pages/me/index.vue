<template>
  <view class="page" :style="{ paddingTop: `${contentTop}px` }">
    <view class="page__content">
      <view class="page__top">
        <!-- Profile Head：头像 + 昵称 + 右上角铃铛/设置 -->
        <view class="profile">
          <AppAvatar :src="user.profile?.avatar" :name="name" :size="64" />
          <view class="profile__info">
            <text class="profile__name">{{ name }}</text>
            <text class="profile__meta">ID {{ user.profile?.id ?? '-' }} · 加入 {{ joinedDays }} 天</text>
          </view>
          <view class="profile__actions">
            <view class="profile__icon" hover-class="profile__icon--active" @tap="go('/pages/settings/notifications')">
              <AppIcon name="bell" :size="17" color="#09090B" />
              <view v-if="unread" class="profile__dot" />
            </view>
            <view class="profile__icon" hover-class="profile__icon--active" @tap="go('/pages/settings/index')">
              <AppIcon name="settings" :size="17" color="#09090B" />
            </view>
          </view>
        </view>

        <!-- 两组入口 -->
        <view class="entries">
          <view class="entry" hover-class="entry--active" @tap="go('/pages/me/created')">
            <view class="entry__icon">
              <AppIcon name="file-text" :size="18" color="#4F46E5" />
            </view>
            <view class="entry__text">
              <text class="entry__title">我发起的</text>
              <text class="entry__desc">管理我发起的投票与问卷</text>
            </view>
            <view class="entry__right">
              <text v-if="createdCount !== null" class="entry__count">{{ createdCount }}</text>
              <AppIcon name="chevron-right" :size="15" color="#A1A1AA" />
            </view>
          </view>

          <view class="entry" hover-class="entry--active" @tap="go('/pages/me/joined')">
            <view class="entry__icon">
              <AppIcon name="square-check" :size="18" color="#4F46E5" />
            </view>
            <view class="entry__text">
              <text class="entry__title">我参与的</text>
              <text class="entry__desc">查看我参与过的投票与问卷</text>
            </view>
            <view class="entry__right">
              <text v-if="joinedCount !== null" class="entry__count">{{ joinedCount }}</text>
              <AppIcon name="chevron-right" :size="15" color="#A1A1AA" />
            </view>
          </view>
        </view>
      </view>

      <!-- 设计稿 40：帮助与反馈是底部一个居中链接，不是列表行 -->
      <view class="page__help" @tap="go('/pages/support/index')">
        <text class="page__help-text">帮助与反馈</text>
      </view>
    </view>

    <AppTabBar current="me" />
    <view class="page__tabspace" :style="{ height: `calc(64px + ${safeBottom}px)` }" />
  </view>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppIcon from '@/components/base/AppIcon.vue'
import AppAvatar from '@/components/base/AppAvatar.vue'
import AppTabBar from '@/components/base/AppTabBar.vue'
import { useUserStore } from '@/stores/user'
import { fetchMyPolls, fetchJoinedPolls } from '@/api/poll'
import { getSafeArea } from '@/utils/platform'
import { hideNativeTabBar } from '@/utils/tab'

/**
 * 40 我的
 *
 * 设计稿没有导航栏：昵称就是页面标题（24/bold），铃铛和齿轮跟着这一行靠右。
 * 所以整块内容整体下移到胶囊下沿以下，右上角两个 38 的按钮才不会被胶囊盖住。
 *
 * 入口右侧的数字和对应列表页的总数一致，都取 total，不在前端另算。
 */
const user = useUserStore()
const name = computed(() => user.profile?.nickname ?? '未登录')
const joinedDays = computed(() => {
  const at = user.profile?.createdAt
  if (!at) return 0
  return Math.floor((Date.now() - at) / (24 * 3600 * 1000))
})

const { contentTop, safeBottom } = getSafeArea()

const createdCount = ref<number | null>(null)
const joinedCount = ref<number | null>(null)
const unread = ref(true)

onMounted(async () => {
  try {
    const [mine, joined] = await Promise.all([fetchMyPolls('all'), fetchJoinedPolls('all')])
    createdCount.value = mine.total
    joinedCount.value = joined.total
  } catch {
    // 计数只是辅助信息，取不到就不显示
  }
})

/** H5 端会渲染原生 tabBar，进来就藏掉（微信端 custom=true，没有原生栏，静默失败） */
onShow(hideNativeTabBar)

function go(url: string) {
  uni.navigateTo({ url })
}
</script>

<script lang="ts">
export default { name: 'MePage' }
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  /* 设计稿 Content：gap 16、padding [8,20,12,20]，帮助链接被 space_between 推到底部 */
  &__content {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 16px;
    padding: 8px $gutter 12px;
  }

  &__top {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  &__help {
    padding-top: 8px;
    display: flex;
    justify-content: center;
  }

  &__help-text {
    font-size: 12px;
    color: $faint;
  }
}

.profile {
  display: flex;
  align-items: center;
  gap: 14px;

  &__info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  &__name {
    font-size: 24px;
    font-weight: 700;
    color: $ink;
    line-height: 1.25;
  }

  &__meta {
    font-size: 12px;
    color: $faint;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  /* 设计稿：38×38、圆 19、白底、1px $line、图标 17 */
  &__icon {
    width: 38px;
    height: 38px;
    border-radius: 19px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;

    &--active {
      opacity: 0.7;
    }
  }

  &__dot {
    position: absolute;
    top: 8px;
    right: 6px;
    width: 8px;
    height: 8px;
    border-radius: 4px;
    background: $danger;
    border: 1.5px solid $surface;
  }
}

/* 设计稿 Poll Entries：竖向 gap 10，每张卡都是独立的圆角 16 白卡 */
.entries {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.entry {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: $surface;
  border: 1px solid $line;
  border-radius: 16px;

  &--active {
    background: $subtle;
  }

  &__icon {
    width: 38px;
    height: 38px;
    border-radius: 12px;
    background: $accent-soft;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    color: $ink;
  }

  &__desc {
    font-size: 11px;
    color: $faint;
  }

  &__right {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  &__count {
    font-size: 13px;
    font-weight: 600;
    color: $muted;
    font-family: $font-num;
  }
}
</style>
