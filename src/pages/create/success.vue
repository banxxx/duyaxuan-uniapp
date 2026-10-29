<script setup lang="ts">
import { ref } from 'vue'
import { onLoad, onShareAppMessage } from '@dcloudio/uni-app'
import type { Poll } from '@/types/api'
import AppIcon from '@/components/base/AppIcon.vue'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import { useDraftStore } from '@/stores/draft'
import { useSettingsStore } from '@/stores/settings'
import type { PushPrefs } from '@/api/notification'
import { buildShareMessage, syncShareMenu } from '@/utils/share'
import { bottomInset } from '@/utils/platform'
import {
  hasSubscribeTemplates,
  preloadSubscribeTemplates,
  requestSubscribe
} from '@/utils/subscribe'
import { go, reset, ROUTES, switchTab } from '@/utils/router'

/**
 * 39 发布成功 / 81 问卷发布成功
 *
 * 提交发生在进入本页时（onLoad），不是点「发布」那一刻——
 * 这样从规则页退回来还能改，不会产生半成品数据。
 *
 * 海报位保留但不生成图：小程序端生成海报要 canvas + 授权，属于后续迭代；
 * 这一版先把二维码位画出来，点「查看并分享」走系统分享。
 */
const draft = useDraftStore()
const settings = useSettingsStore()

const poll = ref<Poll | null>(null)
const loading = ref(true)
const failed = ref(false)

const isSurvey = ref(false)
/** 本次是否已经同意过订阅（只影响按钮文案，不代表永久订阅） */
const notifyOn = ref(false)
/** 服务端配了订阅模板才显示入口，否则点了也不会弹授权框 */
const canNotify = ref(false)

async function submit() {
  loading.value = true
  failed.value = false
  try {
    isSurvey.value = draft.draft.type === 'survey'
    const created = await draft.submit()
    poll.value = created
    syncShareMenu(created.rules.allowShare)
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

onLoad(() => {
  settings.restore()
  // 模板 ID 提前拉好，点「开启消息提醒」时才能同步弹授权框
  preloadSubscribeTemplates().then(() => {
    canNotify.value = hasSubscribeTemplates()
  })
  submit()
})

function goData() {
  // 创建流程已经结束：把 type/content/rules 三层从栈里清掉，
  // 否则从数据页返回会退回到填完的规则页，而不是首页
  if (poll.value) reset(ROUTES.creatorData, { id: poll.value.id })
}

function goDetail() {
  if (poll.value) reset(ROUTES.detail, { id: poll.value.id })
}

function goHome() {
  switchTab(ROUTES.home)
}

/**
 * 发布后引导发起人开一次订阅：这是「有人参与 / 有评论」通知的接收方，
 * 放在这里比藏进设置页更容易被点。微信一次授权只换一条消息。
 */
function enableNotify() {
  if (notifyOn.value) return
  const s = settings.settings
  const prefs: PushPrefs = {
    enabled: s.pushEnabled,
    joined: s.pushJoined,
    comment: s.pushComment,
    deadline: s.pushDeadline,
    result: s.pushResult,
    updated: s.pushUpdated
  }
  requestSubscribe(['joined', 'comment'], prefs, (accepted) => {
    if (!accepted.length) return
    notifyOn.value = true
    uni.showToast({ title: '已开启消息提醒', icon: 'none' })
  })
}

/** 27/80 分享页：海报 + 分享渠道 */
function goShare() {
  if (poll.value) go(ROUTES.share, { id: poll.value.id })
}

onShareAppMessage(() =>
  poll.value ? buildShareMessage(poll.value) : { title: '投票吧', path: '/pages/index/index' }
)
</script>

<template>
  <view class="published">
    <AppNavBar :back="false" />

    <view v-if="loading" class="published__body">
      <AppSkeleton type="detail" />
    </view>

    <view v-else-if="failed" class="published__body">
      <AppEmpty
        icon="wifi-off"
        title="发布失败"
        desc="内容还在草稿里，检查网络后重试"
        action="重新发布"
        @action="submit"
      />
    </view>

    <scroll-view v-else-if="poll" class="published__scroll" scroll-y>
      <view class="published__content" :style="{ paddingBottom: bottomInset(24) }">
        <!-- 和 71 投票成功页同一套入场：图标先弹出来，文字依次跟上 -->
        <view class="mark anim anim--success">
          <AppIcon name="party-popper" :size="44" color="#4F46E5" :stroke-width="2" />
        </view>

        <text class="published__title anim anim--fade-up anim--stagger-2">{{ isSurvey ? '问卷已发布' : '投票已发布' }}</text>
        <text class="published__desc anim anim--fade-up anim--stagger-3">
          分享出去，邀请更多同事{{ isSurvey ? '填写' : '参与' }}吧
        </text>

        <!-- 海报位 -->
        <view class="poster">
          <view class="poster__thumb">
            <view class="poster__thumb-top">
              <text class="poster__thumb-title">{{ poll.title }}</text>
            </view>
            <view class="poster__thumb-body">
              <view class="poster__qr">
                <view class="poster__qr-corner poster__qr-corner--tl" />
                <view class="poster__qr-corner poster__qr-corner--tr" />
                <view class="poster__qr-corner poster__qr-corner--bl" />
              </view>
              <text class="poster__thumb-scan">扫码{{ isSurvey ? '填写' : '参与' }}</text>
            </view>
            <view class="poster__thumb-foot">
              <text class="poster__thumb-by">由 {{ poll.creatorName }} 发起</text>
            </view>
          </view>

          <view class="poster__info">
            <text class="poster__info-title">分享海报</text>
            <text class="poster__info-desc">
              已生成专属邀请海报，扫码即可{{ isSurvey ? '参与填写' : '参与投票' }}
            </text>
            <view class="poster__open" @tap="goShare">
              <text class="poster__open-text">查看并分享</text>
              <AppIcon name="chevron-right" :size="13" color="#4F46E5" />
            </view>
          </view>
        </view>

        <!-- 分享渠道：小程序无法主动区分微信/朋友圈/更多，统一走胶囊转发，这里不再放三个只会弹 toast 的假入口 -->

        <!-- 三个出口 -->
        <view class="actions">
          <view class="actions__primary" hover-class="actions__primary--active" @tap="goData">
            <text class="actions__primary-text">查看实时数据</text>
          </view>
          <view class="actions__secondary" hover-class="actions__secondary--active" @tap="goDetail">
            <text class="actions__secondary-text">查看{{ isSurvey ? '问卷' : '投票' }}详情</text>
          </view>
          <view
            v-if="canNotify"
            class="actions__secondary"
            :class="{ 'actions__secondary--on': notifyOn }"
            hover-class="actions__secondary--active"
            @tap="enableNotify"
          >
            <text class="actions__secondary-text" :class="{ 'actions__secondary-text--on': notifyOn }">
              {{ notifyOn ? '已开启消息提醒' : '开启消息提醒' }}
            </text>
          </view>
          <view class="actions__secondary" hover-class="actions__secondary--active" @tap="goHome">
            <text class="actions__secondary-text">返回首页</text>
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script lang="ts">
export default { name: 'CreateSuccessPage' }
</script>

<style lang="scss" scoped>
.published {
  /* 定高：scroll-view 需要父级有确定高度，min-height 在真机上会让它塌成 0 高 */
  height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  &__body {
    flex: 1;
  }

  &__scroll {
    flex: 1;
    height: 0;
  }

  &__content {
    /* 下边距由 bottomInset(24) 内联控制 */
    padding: 40px 24px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
  }
  &__title {
    font-size: 26px;
    font-weight: 700;
    color: $ink;
  }

  &__desc {
    font-size: 13px;
    color: $muted;
  }
}

.mark {
  width: 96px;
  height: 96px;
  border-radius: 48px;
  background: $accent-soft;
  display: flex;
  align-items: center;
  justify-content: center;
}

.poster {
  width: 100%;
  padding: 14px;
  border-radius: 16px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  gap: 14px;

  &__thumb {
    width: 92px;
    border-radius: 9px;
    overflow: hidden;
    background: #fff;
    border: 1px solid $line;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
  }

  &__thumb-top {
    height: 46px;
    padding: 7px;
    background: $ink;
  }

  &__thumb-title {
    font-size: 7px;
    font-weight: 600;
    color: #fff;
    line-height: 1.3;
  }

  &__thumb-body {
    height: 63px;
    padding: 6px 7px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
  }

  /* 二维码占位：三个定位角 + 空白，真实二维码后续用 canvas 生成 */
  &__qr {
    width: 40px;
    height: 40px;
    position: relative;
    background: $surface;
    border-radius: 2px;
  }

  &__qr-corner {
    position: absolute;
    width: 11px;
    height: 11px;
    border: 3px solid $ink;
    border-radius: 1px;

    &--tl {
      top: 3px;
      left: 3px;
    }

    &--tr {
      top: 3px;
      right: 3px;
    }

    &--bl {
      bottom: 3px;
      left: 3px;
    }
  }

  &__thumb-scan {
    font-size: 6px;
    color: $muted;
  }

  &__thumb-foot {
    height: 16px;
    padding: 4px 7px;
    background: $subtle;
  }

  &__thumb-by {
    font-size: 6px;
    color: $muted;
  }

  &__info {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 5px;
  }

  &__info-title {
    font-size: 14px;
    font-weight: 600;
    color: $ink;
  }

  &__info-desc {
    font-size: 11px;
    color: $faint;
    line-height: 1.45;
  }

  &__open {
    display: flex;
    align-items: center;
    gap: 3px;
    margin-top: 2px;
    padding: 0;
    background: transparent;
    line-height: normal;
    font-size: inherit;

    &::after {
      border: none;
    }
  }

  &__open-text {
    font-size: 12px;
    font-weight: 600;
    color: $accent;
  }
}

.actions {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__primary {
    height: 52px;
    border-radius: 14px;
    background: $accent;
    display: flex;
    align-items: center;
    justify-content: center;

    &--active {
      opacity: 0.88;
    }
  }

  &__primary-text {
    font-size: 15px;
    font-weight: 600;
    color: #fff;
  }

  &__secondary {
    height: 52px;
    border-radius: 14px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    justify-content: center;

    &--active {
      background: $subtle;
    }

    /* 已经同意过订阅：按钮变成「已开启」，视觉上不再催用户点 */
    &--on {
      background: $accent-soft;
      border-color: $accent;
    }
  }

  &__secondary-text {
    font-size: 15px;
    font-weight: 600;
    color: $ink;

    &--on {
      color: $accent;
    }
  }
}
</style>
