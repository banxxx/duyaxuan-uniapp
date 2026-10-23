<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSwitch from '@/components/base/AppSwitch.vue'
import { mockNotifications } from '@/mock/data'
import type { Notification } from '@/mock/data'
import { useSettingsStore } from '@/stores/settings'
import { formatRelative } from '@/utils/format'
import { bottomInset } from '@/utils/platform'
import { ROUTES, go } from '@/utils/router'

/**
 * 44 消息通知 + 55 推送通知设置
 *
 * 两屏合成一页，用 tab 切：
 *   tab=list（默认）→ 44 消息列表，从「我的」右上角铃铛进来
 *   tab=push        → 55 推送开关，从「设置 · 推送通知」进来
 *
 * 为什么合：两者是同一件事的两面——「收到了什么」和「想收到什么」。
 * 分两页时用户找不到开关在哪，这是消息类页面最常见的抱怨。
 */
const settings = useSettingsStore()

const tab = ref<'list' | 'push'>('list')
const filter = ref<'all' | 'unread'>('all')
const list = ref<Notification[]>([])

const unreadCount = computed(() => list.value.filter((n) => !n.read).length)
const shown = computed(() =>
  filter.value === 'unread' ? list.value.filter((n) => !n.read) : list.value
)

onLoad((q) => {
  if (q?.tab === 'push') tab.value = 'push'
})

onMounted(() => {
  settings.restore()
  list.value = mockNotifications.map((n) => ({ ...n }))
})

function open(n: Notification) {
  n.read = true
  if (n.pollId) go(ROUTES.detail, { id: n.pollId })
}

function markAllRead() {
  list.value.forEach((n) => (n.read = true))
  uni.showToast({ title: '已全部标为已读', icon: 'none' })
}

/** 设计稿 44 右上角是「···」，不是文字：收纳全部已读和推送设置 */
function openMore() {
  uni.showActionSheet({
    itemList: ['全部标为已读', '推送通知设置'],
    success: (r) => {
      if (r.tapIndex === 0) markAllRead()
      else tab.value = 'push'
    }
  })
}

function set<K extends 'pushEnabled' | 'pushDeadline' | 'pushJoined' | 'pushResult' | 'pushUpdated'>(
  key: K,
  v: boolean
) {
  settings.set(key, v)
}

/** 图标随通知类型变（设计稿 44：megaphone / message-square / trophy / users / circle-check） */
function iconOf(kind: Notification['kind']) {
  switch (kind) {
    case 'deadline':
      return 'megaphone'
    case 'comment':
      return 'message-square'
    case 'result':
      return 'trophy'
    case 'joined':
      return 'users'
    default:
      return 'circle-check'
  }
}
</script>

<template>
  <view class="notif">
    <AppNavBar :title="tab === 'push' ? '推送通知' : '消息通知'">
      <template #right>
        <view v-if="tab === 'list'" class="notif__more" hover-class="notif__more--active" @tap="openMore">
          <AppIcon name="ellipsis" :size="17" color="#09090B" />
          <view v-if="unreadCount" class="notif__more-dot" />
        </view>
      </template>
    </AppNavBar>

    <!-- ============ 44 消息列表 ============ -->
    <template v-if="tab === 'list'">
      <scroll-view class="notif__scroll" scroll-y>
        <view class="notif__content" :style="{ paddingBottom: bottomInset(20) }">
          <view class="tabs">
            <view
              class="tabs__item"
              :class="{ 'tabs__item--on': filter === 'all' }"
              @tap="filter = 'all'"
            >
              <text class="tabs__text" :class="{ 'tabs__text--on': filter === 'all' }">全部</text>
            </view>
            <view
              class="tabs__item"
              :class="{ 'tabs__item--on': filter === 'unread' }"
              @tap="filter = 'unread'"
            >
              <text class="tabs__text" :class="{ 'tabs__text--on': filter === 'unread' }">
                未读 {{ unreadCount }}
              </text>
            </view>
          </view>

          <view
            v-for="n in shown"
            :key="n.id"
            class="msg"
            :class="{ 'msg--unread': !n.read }"
            hover-class="msg--active"
            @tap="open(n)"
          >
            <view class="msg__icon" :class="`msg__icon--${n.kind}`">
              <AppIcon :name="iconOf(n.kind)" :size="16" :color="n.read ? '#71717A' : '#4F46E5'" />
            </view>

            <view class="msg__body">
              <view class="msg__top">
                <view class="msg__lead">
                  <text class="msg__title">{{ n.title }}</text>
                  <view v-if="!n.read" class="msg__dot" />
                </view>
                <text class="msg__time">{{ formatRelative(n.createdAt) }}</text>
              </view>
              <text class="msg__content">{{ n.content }}</text>
            </view>
          </view>

          <AppEmpty
            v-if="!shown.length"
            icon="bell"
            title="没有未读消息"
            desc="有人参与你的投票、结果公布时会在这里提醒你"
          />
        </view>
      </scroll-view>
    </template>

    <!-- ============ 55 推送设置 ============ -->
    <scroll-view v-else class="notif__scroll" scroll-y>
      <view class="notif__content notif__content--push" :style="{ paddingBottom: bottomInset(20) }">
        <text class="notif__group">总开关</text>

        <view class="card">
          <view class="row row--master">
            <view class="row__text">
              <text class="row__title">接收推送通知</text>
              <text class="row__desc">关闭后将不再收到任何投票提醒</text>
            </view>
            <AppSwitch
              :model-value="settings.settings.pushEnabled"
              @update:model-value="(v) => set('pushEnabled', v)"
            />
          </view>
        </view>

        <text class="notif__group">提醒类型</text>

        <view class="card" :class="{ 'card--off': !settings.settings.pushEnabled }">
          <view class="row">
            <view class="row__text">
              <text class="row__title">投票即将截止</text>
              <text class="row__desc">截止前 1 天提醒</text>
            </view>
            <AppSwitch
              :model-value="settings.settings.pushDeadline"
              :disabled="!settings.settings.pushEnabled"
              @update:model-value="(v) => set('pushDeadline', v)"
            />
          </view>

          <view class="card__sep" />

          <view class="row">
            <view class="row__text">
              <text class="row__title">有人参与我的投票</text>
              <text class="row__desc">实时提醒</text>
            </view>
            <AppSwitch
              :model-value="settings.settings.pushJoined"
              :disabled="!settings.settings.pushEnabled"
              @update:model-value="(v) => set('pushJoined', v)"
            />
          </view>

          <view class="card__sep" />

          <view class="row">
            <view class="row__text">
              <text class="row__title">投票结果公布</text>
              <text class="row__desc">结果生成后提醒</text>
            </view>
            <AppSwitch
              :model-value="settings.settings.pushResult"
              :disabled="!settings.settings.pushEnabled"
              @update:model-value="(v) => set('pushResult', v)"
            />
          </view>

          <view class="card__sep" />

          <view class="row">
            <view class="row__text">
              <text class="row__title">我参与的投票有更新</text>
              <text class="row__desc">发起人修改了投票</text>
            </view>
            <AppSwitch
              :model-value="settings.settings.pushUpdated"
              :disabled="!settings.settings.pushEnabled"
              @update:model-value="(v) => set('pushUpdated', v)"
            />
          </view>
        </view>

        <text class="notif__note">
          推送依赖微信订阅消息授权，若系统层关闭通知，本页开关将不生效。
        </text>
      </view>
    </scroll-view>
  </view>
</template>

<script lang="ts">
export default { name: 'NotificationsPage' }
</script>

<style lang="scss" scoped>
.notif {
  min-height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  &__more {
    width: 34px;
    height: 34px;
    border-radius: 17px;
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

  &__more-dot {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: $danger;
    border: 1px solid $surface;
  }

  &__scroll {
    flex: 1;
    height: 0;
  }

  /* 设计稿 44：Content 竖向流 gap 12、padding [8,20,20,20]；下边距由 bottomInset(20) 内联控制 */
  &__content {
    padding: 8px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;

    /* 55：标题+卡片+标题+卡片+脚注，全部按 16 拉开 */
    &--push {
      gap: 16px;
    }
  }

  &__group {
    font-size: 11px;
    font-weight: 600;
    color: $faint;
    padding-top: 2px;
  }

  &__note {
    font-size: 11px;
    color: $faint;
    line-height: 1.6;
    padding: 6px 2px 0;
  }
}

/* 44 的分段控件：整行宽、$subtle 轨道 + 白色选中块（与 15/26 同一套） */
.tabs {
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

.msg {
  padding: 14px;
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  gap: 11px;
  align-items: flex-start;

  &--active {
    background: $subtle;
  }

  // 已读的图标底色降一级，视觉上不再抢注意力
  &__icon {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    background: $subtle;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &--unread &__icon {
    background: $accent-soft;
  }

  &__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  // 标题 + 未读红点是一组，靠左；时间单独靠右
  &__lead {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  &__title {
    font-size: 13px;
    font-weight: 600;
    color: $ink;
  }

  &__time {
    font-size: 10px;
    color: $faint;
    flex-shrink: 0;
  }

  &__content {
    flex: 1;
    font-size: 11px;
    color: $muted;
    line-height: 1.5;
  }

  &__dot {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: $accent;
    flex-shrink: 0;
  }
}

.card {
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;
  overflow: hidden;

  &--off {
    opacity: 0.55;
  }

  &__sep {
    height: 1px;
    background: $line;
  }
}

.row {
  padding: 13px 15px;
  display: flex;
  align-items: center;
  gap: 12px;

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__title {
    font-size: 13px;
    color: $ink;
  }

  &__desc {
    font-size: 11px;
    color: $faint;
  }
}

/* 55 的总开关那一行稍大一号：padding [14,15]、14 标题 + 3 的行距 */
.row--master {
  padding: 14px 15px;

  .row__title {
    font-size: 14px;
  }

  .row__text {
    gap: 3px;
  }
}
</style>
