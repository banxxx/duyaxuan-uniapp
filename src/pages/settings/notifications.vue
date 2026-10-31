<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSwitch from '@/components/base/AppSwitch.vue'
import AppActionSheet from '@/components/base/AppActionSheet.vue'
import type { Notification } from '@/types/api'
import {
  fetchNotifications,
  fetchPushPrefs,
  markNotificationsRead,
  savePushPrefs,
  type PushKind,
  type PushPrefs
} from '@/api/notification'
import { useSettingsStore } from '@/stores/settings'
import {
  hasSubscribeTemplates,
  preloadSubscribeTemplates,
  requestSubscribe
} from '@/utils/subscribe'
import { formatRelative } from '@/utils/format'
import { bottomInset, isWeixinLike } from '@/utils/platform'
import { ROUTES, go } from '@/utils/router'
import AppToast from '@/components/base/AppToast.vue'
import { toast } from '@/utils/toast'

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
const cursor = ref<string | null>(null)
const hasMore = ref(false)
const loading = ref(false)

const unreadCount = computed(() => list.value.filter((n) => !n.read).length)

/** 导航栏「···」：自定义底部菜单，和站内其他操作面板统一 */
const moreVisible = ref(false)
const moreItems = computed(() => [
  {
    key: 'read',
    label: '全部标为已读',
    icon: 'square-check',
    disabled: unreadCount.value === 0
  },
  { key: 'push', label: '推送通知设置', icon: 'message-square-text' }
])
const shown = computed(() =>
  filter.value === 'unread' ? list.value.filter((n) => !n.read) : list.value
)

onLoad((q) => {
  if (q?.tab === 'push') tab.value = 'push'
})

/** 服务端没配模板时，开关仍然保存，但不会弹订阅授权框 —— 说明一下免得以为坏了 */
const noTemplates = ref(false)
/** 非微信端（H5 / QQ / 抖音）没有微信服务通知，整个分组都不该出现 */
const showWechatPush = isWeixinLike()

/** 服务端偏好是最终事实：本地只是缓存，换设备/清缓存后要以服务端为准 */
function applyPrefs(p: PushPrefs) {
  settings.set('pushEnabled', p.enabled)
  settings.set('pushDeadline', p.deadline)
  settings.set('pushJoined', p.joined)
  settings.set('pushComment', p.comment)
  settings.set('pushResult', p.result)
  settings.set('pushUpdated', p.updated)
}

onMounted(() => {
  settings.restore()
  // 模板 ID 要提前拿到：用户点开关时再请求就赶不上「点击手势」了
  preloadSubscribeTemplates().then(() => {
    noTemplates.value = !hasSubscribeTemplates()
  })
  load()
  if (showWechatPush) {
    fetchPushPrefs().then(applyPrefs).catch(() => {})
  }
})

/** 第一页 / 翻页共用；下拉和滚动到底都走这里 */
async function load(more = false) {
  if (loading.value) return
  loading.value = true
  try {
    const page = await fetchNotifications(more ? cursor.value : null)
    list.value = more ? [...list.value, ...page.list] : page.list
    cursor.value = page.cursor
    hasMore.value = page.hasMore
  } finally {
    loading.value = false
  }
}

function loadMore() {
  if (hasMore.value) load(true)
}

function open(n: Notification) {
  if (!n.read) {
    n.read = true
    // 标记失败不影响阅读，下一条列表会再同步
    markNotificationsRead([n.id]).catch(() => {})
  }
  if (n.pollId) go(ROUTES.detail, { id: n.pollId })
}

async function markAllRead() {
  const unread = list.value.filter((n) => !n.read)
  if (!unread.length) return
  try {
    await markNotificationsRead()
    unread.forEach((n) => (n.read = true))
    toast.success('已全部标为已读')
  } catch {
    // toast 由请求层给出
  }
}

/** 设计稿 44 右上角是「···」，不是文字：收纳全部已读和推送设置 */
function openMore() {
  moreVisible.value = true
}

function onMoreAction(key: string) {
  if (key === 'read') markAllRead()
  else tab.value = 'push'
}

type SwitchKey =
  | 'pushEnabled'
  | 'pushDeadline'
  | 'pushJoined'
  | 'pushComment'
  | 'pushResult'
  | 'pushUpdated'

/** 开关 → 服务端模板类型；pushUpdated 目前没有对应的通知，纯本地偏好 */
const KIND_OF: Partial<Record<SwitchKey, PushKind>> = {
  pushJoined: 'joined',
  pushComment: 'comment',
  pushDeadline: 'deadline',
  pushResult: 'result',
  pushUpdated: 'updated'
}

/** 本地开关 → 服务端偏好（订阅消息由服务端发，本地开关拦不住） */
function prefsOf(): PushPrefs {
  const s = settings.settings
  return {
    enabled: s.pushEnabled,
    joined: s.pushJoined,
    comment: s.pushComment,
    deadline: s.pushDeadline,
    result: s.pushResult,
    updated: s.pushUpdated
  }
}

function set(key: SwitchKey, v: boolean) {
  settings.set(key, v)
  const prefs = prefsOf()

  // 打开开关时顺手要一次订阅授权。必须在 tap 回调里同步调用，
  // 所以 requestSubscribe 内部只用缓存好的模板 ID，不做网络请求。
  if (v) {
    if (key === 'pushEnabled') {
      // 微信一次最多 3 个模板，总开关先要最常用的三个
      requestSubscribe(['comment', 'deadline', 'result'], prefs)
    } else {
      const kind = KIND_OF[key]
      if (kind) requestSubscribe([kind], prefs)
    }
  }

  // 关掉时也要同步：否则服务端还会按旧偏好发
  savePushPrefs(prefs).catch(() => {})
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
    case 'updated':
      return 'square-pen'
    default:
      return 'circle-check'
  }
}
</script>

<template>
  <view class="notif">
    <AppToast />
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
      <scroll-view class="notif__scroll" scroll-y @scrolltolower="loadMore">
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
            v-for="(n, i) in shown"
            :key="n.id"
            class="msg anim anim--fade-up"
            :class="{ 'msg--unread': !n.read }"
            :style="{ animationDelay: `${Math.min(i, 8) * 35}ms` }"
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
            :title="filter === 'unread' ? '没有未读消息' : '还没有消息'"
            desc="有人参与你的投票、评论或回复时会在这里提醒你"
          />

          <view v-if="hasMore" class="notif__more-row">
            <text class="notif__more-text" @tap="loadMore">
              {{ loading ? '加载中…' : '加载更多' }}
            </text>
          </view>
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

        <template v-if="showWechatPush">
          <text class="notif__group">微信服务通知</text>

          <view class="card" :class="{ 'card--off': !settings.settings.pushEnabled }">
          <view class="row">
            <view class="row__text">
              <text class="row__title">投票即将截止</text>
              <text class="row__desc">结束前 2 小时提醒（时长不足 2 小时的投票不提醒）</text>
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
              <text class="row__desc">仅第一次有人参与时提醒</text>
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
              <text class="row__title">新的评论和回复</text>
              <text class="row__desc">有人在我的投票下留言</text>
            </view>
            <AppSwitch
              :model-value="settings.settings.pushComment"
              :disabled="!settings.settings.pushEnabled"
              @update:model-value="(v) => set('pushComment', v)"
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
              <text class="row__desc">发起人修改后提醒（每小时最多一条）</text>
            </view>
            <AppSwitch
              :model-value="settings.settings.pushUpdated"
              :disabled="!settings.settings.pushEnabled"
              @update:model-value="(v) => set('pushUpdated', v)"
            />
          </view>
          </view>

          <text v-if="noTemplates" class="notif__note">
            服务端还没有配置订阅消息模板，现在只会收到站内消息；开关会保存，配置模板后自动生效。
          </text>
          <text v-else class="notif__note">
            站内消息始终记录在消息中心，本页开关只控制是否推送微信服务通知。微信订阅消息是「一次授权、一条消息」：打开开关时会弹窗征求同意，每同意一次只能收到一条，之后需要再次开启。若系统层关闭通知，本页开关将不生效。
          </text>
        </template>

        <text v-else class="notif__note">
          当前平台不发送微信服务通知，站内消息会照常记录在消息中心。
        </text>
      </view>
    </scroll-view>

    <AppActionSheet
      :visible="moreVisible"
      title="更多操作"
      :items="moreItems"
      @close="moreVisible = false"
      @select="onMoreAction"
    />
  </view>
</template>

<script lang="ts">
export default { name: 'NotificationsPage' }
</script>

<style lang="scss" scoped>
.notif {
  /* 定高：scroll-view 需要父级有确定高度，min-height 在真机上会让它塌成 0 高 */
  height: 100vh;
  /* #ifdef H5 */
  height: 100dvh;
  /* #endif */
  background: $bg;
  display: flex;
  flex-direction: column;

  &__more {
    width: 34px;
    height: 34px;
    border-radius: $r-circle;
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

  /* 列表底部的「加载更多」 */
  &__more-row {
    padding: 4px 0 8px;
    display: flex;
    justify-content: center;
  }

  &__more-text {
    font-size: $fs-11;
    color: $faint;
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
    font-size: $fs-11;
    font-weight: 600;
    color: $faint;
    padding-top: 2px;
  }

  &__note {
    font-size: $fs-11;
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
  border-radius: $r-md;
  background: $subtle;

  &__item {
    flex: 1;
    padding: 8px 0;
    border-radius: $r-chip;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color $dur-fast $ease-both;

    &--on {
      background: $surface;
    }
  }

  &__text {
    font-size: $fs-12;
    font-weight: 500;
    color: $muted;
    transition: color $dur-fast $ease-both;

    &--on {
      color: $ink;
      font-weight: 600;
    }
  }
}

.msg {
  padding: 14px;
  border-radius: $r-input;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  gap: 11px;
  align-items: flex-start;
  transition: background-color $dur-fast $ease-both;

  &--active {
    background: $subtle;
  }

  // 已读的图标底色降一级，视觉上不再抢注意力
  &__icon {
    width: 34px;
    height: 34px;
    border-radius: $r-sm;
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
    font-size: $fs-13;
    font-weight: 600;
    color: $ink;
  }

  &__time {
    font-size: $fs-10;
    color: $faint;
    flex-shrink: 0;
  }

  &__content {
    flex: 1;
    font-size: $fs-11;
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
  border-radius: $r-input;
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
    font-size: $fs-13;
    color: $ink;
  }

  &__desc {
    font-size: $fs-11;
    color: $faint;
  }
}

/* 55 的总开关那一行稍大一号：padding [14,15]、14 标题 + 3 的行距 */
.row--master {
  padding: 14px 15px;

  .row__title {
    font-size: $fs-14;
  }

  .row__text {
    gap: 3px;
  }
}
</style>
