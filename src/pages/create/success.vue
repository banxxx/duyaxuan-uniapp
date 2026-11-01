<script setup lang="ts">
import { ref } from 'vue'
import { onLoad, onShareAppMessage } from '@dcloudio/uni-app'
import type { Poll } from '@/types/api'
import AppIcon from '@/components/base/AppIcon.vue'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import { useDraftStore } from '@/stores/draft'
import { fetchPollQrcode } from '@/api/poll'
import { buildShareMessage, syncShareMenu } from '@/utils/share'
import { bottomInset } from '@/utils/platform'
import { go, reset, ROUTES, switchTab } from '@/utils/router'
import { cacheDrop, cacheKey, cacheSet } from '@/utils/cache'
import { downloadQrImage } from '@/utils/qr-cache'
import AppToast from '@/components/base/AppToast.vue'

/**
 * 39 发布成功 / 81 问卷发布成功
 *
 * 提交发生在进入本页时（onLoad），不是点「发布」那一刻——
 * 这样从规则页退回来还能改，不会产生半成品数据。
 *
 * 缩略海报先画手绘码位（三个定位角），真小程序码到了再盖上去。
 * 这块只有 40×40，没人会拿它扫码，先出画面比先出码重要；
 * 真码在后端生成（R2 缓存）要一两秒，等它会把整块海报拖成「空白 + 转圈」。
 * 码图同时会存进本地缓存，点「查看并分享」进 27/80 海报页时就不用再等一次。
 *
 * 这里不再放「开启消息提醒」：订阅消息是一次授权换一条，入口在
 * 「设置 · 消息通知」里更合适，发布成功页留一个按钮反而和三个出口抢注意力。
 */
const draft = useDraftStore()

const poll = ref<Poll | null>(null)
const loading = ref(true)
const failed = ref(false)

const isSurvey = ref(false)

/** 缩略图里的小程序码；空字符串表示还在生成，此时显示手绘码位 */
const qrUrl = ref('')

async function submit() {
  loading.value = true
  failed.value = false
  try {
    isSurvey.value = draft.draft.type === 'survey'
    const created = await draft.submit()
    poll.value = created
    syncShareMenu(created.rules.allowShare)
    // 刚发布，我发起的列表缓存里还没有它，进列表时要重新拉
    cacheDrop('list:mine')
    loadQr(created.id)
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

/**
 * 小程序码单独请求：生成要调一次微信接口，慢的时候一两秒。
 *
 * 页面不等它 —— 海报上先画码位，回来再淡入真码；
 * 同时把图存进本地，紧接着进分享页时可以直接读文件。
 */
async function loadQr(id: string) {
  try {
    const url = await fetchPollQrcode(id)
    qrUrl.value = url
    // 顺手把分享页的快照写好：用户点「查看并分享」时，海报和码都不用再等一次
    if (poll.value?.id === id) {
      cacheSet(cacheKey.pollShare(id), { poll: poll.value, qrUrl: url })
    }
    // 再存一份到本地文件：小程序里分享页可以直接读文件，连图都不用下
    void downloadQrImage(id, url)
  } catch {
    // 没配 AppID / 没开 R2 / 网络问题都保持手绘码位，不影响本页
  }
}

onLoad(() => {
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

/** 27/80 分享页：海报 + 分享渠道 */
function goShare() {
  if (poll.value) go(ROUTES.share, { id: poll.value.id })
}

onShareAppMessage(() =>
  poll.value ? buildShareMessage(poll.value) : { title: '杜雅轩', path: '/pages/index/index' }
)
</script>

<template>
  <view class="published">
    <AppToast />
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
          分享出去，邀请更多朋友{{ isSurvey ? '填写' : '参与' }}吧
        </text>

        <!-- 海报位 -->
        <view class="poster">
          <view class="poster__thumb">
            <view class="poster__thumb-top">
              <text class="poster__thumb-title">{{ poll.title }}</text>
            </view>
            <view class="poster__thumb-body">
              <view class="poster__qr">
                <!--
                  手绘码位一直铺在底下，真码到了淡入盖上去。
                  不用「转圈 → 换图」：转圈会让整块海报看起来在加载，
                  而这页的重点是「发布成功」，不是这张 40×40 的图。
                -->
                <view class="poster__qr-corner poster__qr-corner--tl" />
                <view class="poster__qr-corner poster__qr-corner--tr" />
                <view class="poster__qr-corner poster__qr-corner--bl" />
                <image
                  v-if="qrUrl"
                  class="poster__qr-img anim anim--fade"
                  :src="qrUrl"
                  mode="aspectFit"
                  show-menu-by-longpress
                />
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
  /* #ifdef H5 */
  height: 100dvh;
  /* #endif */
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
    font-size: $fs-26;
    font-weight: 700;
    color: $ink;
  }

  &__desc {
    font-size: $fs-13;
    color: $muted;
  }
}

.mark {
  width: 96px;
  height: 96px;
  border-radius: $r-circle;
  background: $accent-soft;
  display: flex;
  align-items: center;
  justify-content: center;
}

.poster {
  width: 100%;
  padding: 14px;
  border-radius: $r-button;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  gap: 14px;

  &__thumb {
    width: 92px;
    border-radius: 9px;
    overflow: hidden;
    background: $white;
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
    font-size: $fs-7;
    font-weight: 600;
    color: $white;
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

  /* 二维码：真码 40×40；拿不到时退回三个定位角的占位 */
  &__qr {
    width: 40px;
    height: 40px;
    position: relative;
    background: $surface;
    border-radius: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* 真码绝对定位盖在码位上面：三个定位角在它下面，图一淡入就看不见了 */
  &__qr-img {
    position: absolute;
    inset: 0;
    width: 40px;
    height: 40px;
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
    font-size: $fs-6;
    color: $muted;
  }

  &__thumb-foot {
    height: 16px;
    padding: 4px 7px;
    background: $subtle;
  }

  &__thumb-by {
    font-size: $fs-6;
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
    font-size: $fs-14;
    font-weight: 600;
    color: $ink;
  }

  &__info-desc {
    font-size: $fs-11;
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
    font-size: $fs-12;
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
    border-radius: $r-input;
    background: $accent;
    display: flex;
    align-items: center;
    justify-content: center;

    &--active {
      opacity: 0.88;
    }
  }

  &__primary-text {
    font-size: $fs-15;
    font-weight: 600;
    color: $white;
  }

  &__secondary {
    height: 52px;
    border-radius: $r-input;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    justify-content: center;

    &--active {
      background: $subtle;
    }
  }

  &__secondary-text {
    font-size: $fs-15;
    font-weight: 600;
    color: $ink;
  }
}

</style>
