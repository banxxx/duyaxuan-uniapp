<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onLoad, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app'
import type { Poll } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import { fetchPoll } from '@/api/poll'
import { formatDateTime } from '@/utils/format'
import { getPlatform } from '@/utils/platform'
import { buildShareMessage, buildTimelineMessage } from '@/utils/share'

/**
 * 27 分享投票 / 80 分享问卷
 *
 * 两个屏只有标题和「参与投票 / 参与填写」的措辞不同，所以共用一页。
 *
 * 海报上的小程序码目前是占位图案：真码要 canvas + 后端下发，
 * 属于后续迭代。这里把版式、比例、间距全部按设计稿做出来，
 * 等接上生成逻辑后只要把 QR 那一块换成 <image> 即可。
 *
 * 分享渠道三格：微信走 open-type=share（小程序不允许代码主动拉起分享面板），
 * 朋友圈和更多只能引导用户去右上角胶囊，点了给一句提示，不做假动作。
 */
const poll = ref<Poll | null>(null)
const loading = ref(true)
const failed = ref(false)
const pollId = ref('')

const isSurvey = computed(() => poll.value?.type === 'survey')
const navTitle = computed(() => (isSurvey.value ? '分享问卷' : '分享投票'))
const scanText = computed(() => `长按识别小程序码 · 参与${isSurvey.value ? '填写' : '投票'}`)
const deadlineText = computed(() =>
  poll.value ? `${formatDateTime(poll.value.rules.endAt)} 截止` : ''
)

/**
 * 小程序码占位：19×19 网格，跳过三个定位角，其余按固定算式点阵。
 *
 * 坐标用百分比而不是 px —— 内联 style 不经过 postcss 的 px→rpx 转换，
 * 写死 px 在 375 宽的机型上会和 140px 的码框对不齐，最后一行越出边界。
 */
const QR_COLS = 19
const QR_ORIGIN = 10
const QR_PITCH = 6.857
const QR_SIZE = 140
const pct = (v: number) => (v / QR_SIZE) * 100
const qrModules: Array<{ x: number; y: number }> = []
for (let r = 0; r < QR_COLS; r++) {
  for (let c = 0; c < QR_COLS; c++) {
    const inFinder =
      (c < 5 && r < 5) ||
      (c >= QR_COLS - 5 && r < 5) ||
      (c < 5 && r >= QR_COLS - 5)
    if (inFinder) continue
    // 固定算式而不是随机数：每次渲染图案一致，切页面不会「闪一下变样」
    if ((r * 31 + c * 17 + r * c * 7) % 11 < 5) {
      qrModules.push({ x: pct(QR_ORIGIN + c * QR_PITCH), y: pct(QR_ORIGIN + r * QR_PITCH) })
    }
  }
}

async function load() {
  loading.value = true
  failed.value = false
  try {
    poll.value = await fetchPoll(pollId.value)
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

onLoad((q) => {
  pollId.value = (q?.id as string) ?? ''
})
onMounted(load)

/** H5 / 抖音里没有微信分享面板，点了至少给个说法 */
function onWechat() {
  if (getPlatform() !== 'h5') return
  uni.showToast({ title: '请在微信小程序中分享', icon: 'none' })
}

function onTimeline() {
  uni.showToast({ title: '点右上角「···」分享到朋友圈', icon: 'none' })
}

function onMore() {
  uni.showToast({ title: '点右上角「···」转发给好友', icon: 'none' })
}

function savePoster() {
  // 真机保存要走 canvas 绘制 + 相册授权，先按未接入处理，不假装已保存
  uni.showToast({ title: '保存到相册即将开放', icon: 'none' })
}

onShareAppMessage(() =>
  poll.value ? buildShareMessage(poll.value) : { title: '投票吧', path: '/pages/index/index' }
)
onShareTimeline(() => (poll.value ? buildTimelineMessage(poll.value) : { title: '投票吧' }))
</script>

<template>
  <view class="share">
    <AppNavBar :title="navTitle" />

    <view v-if="loading" class="share__body">
      <AppSkeleton type="detail" />
    </view>

    <view v-else-if="failed" class="share__body">
      <AppEmpty
        icon="wifi-off"
        title="分享内容加载失败"
        desc="检查网络后重试"
        action="重新加载"
        @action="load"
      />
    </view>

    <scroll-view v-else-if="poll" class="share__scroll" scroll-y>
      <view class="share__content">
        <!-- 海报：白卡 + 黑头 + 小程序码 + 灰底署名 -->
        <view class="poster">
          <view class="poster__top">
            <text class="poster__title">{{ poll.title }}</text>
            <view class="poster__meta">
              <view class="poster__chip">
                <AppIcon name="timer" :size="10" color="rgba(255,255,255,0.6)" :stroke-width="2" />
                <text class="poster__chip-text">{{ deadlineText }}</text>
              </view>
            </view>
          </view>

          <view class="poster__body">
            <view class="poster__qr">
              <view class="poster__finder poster__finder--tl">
                <view class="poster__finder-inner">
                  <view class="poster__finder-core" />
                </view>
              </view>
              <view class="poster__finder poster__finder--tr">
                <view class="poster__finder-inner">
                  <view class="poster__finder-core" />
                </view>
              </view>
              <view class="poster__finder poster__finder--bl">
                <view class="poster__finder-inner">
                  <view class="poster__finder-core" />
                </view>
              </view>
              <view
                v-for="(m, i) in qrModules"
                :key="i"
                class="poster__module"
                :style="{ left: `${m.x}%`, top: `${m.y}%` }"
              />
            </view>
            <text class="poster__scan">{{ scanText }}</text>
          </view>

          <view class="poster__foot">
            <text class="poster__by">由 {{ poll.creatorName }} 发起</text>
          </view>
        </view>

        <!-- 分享渠道 -->
        <view class="channels">
          <button class="channel" open-type="share" @tap="onWechat">
            <AppIcon name="message-circle" :size="21" color="#09090B" :stroke-width="2" />
            <text class="channel__text">微信</text>
          </button>
          <view class="channel" hover-class="channel--active" @tap="onTimeline">
            <AppIcon name="aperture" :size="21" color="#09090B" :stroke-width="2" />
            <text class="channel__text">朋友圈</text>
          </view>
          <view class="channel" hover-class="channel--active" @tap="onMore">
            <AppIcon name="ellipsis" :size="21" color="#09090B" :stroke-width="2" />
            <text class="channel__text">更多</text>
          </view>
        </view>

        <view class="share__actions">
          <AppButton type="ink" size="compact" @tap="savePoster">保存到相册</AppButton>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script lang="ts">
export default { name: 'SharePage' }
</script>

<style lang="scss" scoped>
.share {
  min-height: 100vh;
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

  /* 27/80 Content：上 8、左右 20、下 24，块间距 16 */
  &__content {
    padding: 8px $gutter 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  &__actions {
    width: 100%;
  }
}

.poster {
  width: 300px;
  /* 320 宽的老机型上别顶出屏幕 */
  max-width: 100%;
  background: $surface;
  border: 1px solid $line;
  border-radius: 20px;
  /* 黑头是直角，靠父级裁圆角 */
  overflow: hidden;
  display: flex;
  flex-direction: column;

  &__top {
    padding: 20px;
    background: $ink;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  &__title {
    font-size: 20px;
    font-weight: 700;
    color: #fff;
    line-height: 1.35;
  }

  &__meta {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  &__chip {
    padding: 4px 9px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  &__chip-text {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.8);
  }

  &__body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }

  /* 小程序码占位：140 见方白底 + 1px 描边，三个定位角 + 点阵 */
  &__qr {
    position: relative;
    width: 140px;
    height: 140px;
    background: $surface;
    border: 1px solid $line;
    overflow: hidden;
  }

  &__finder {
    position: absolute;
    width: 30px;
    height: 30px;
    background: $ink;

    &--tl {
      top: 10px;
      left: 10px;
    }

    &--tr {
      top: 10px;
      right: 10px;
    }

    &--bl {
      bottom: 10px;
      left: 10px;
    }
  }

  &__finder-inner {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 22px;
    height: 22px;
    background: $surface;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__finder-core {
    width: 10px;
    height: 10px;
    background: $ink;
  }

  &__module {
    position: absolute;
    /* 6 / 140，跟内联的百分比坐标同一套比例 */
    width: 4.286%;
    height: 4.286%;
    background: $ink;
  }

  &__scan {
    font-size: 11px;
    color: $muted;
  }

  &__foot {
    padding: 12px 20px;
    background: $subtle;
    display: flex;
    align-items: center;
  }

  &__by {
    font-size: 10px;
    color: $muted;
  }
}

.channels {
  width: 100%;
  display: flex;
  justify-content: center;
  gap: 12px;
}

.channel {
  width: 92px;
  height: 92px;
  padding: 0;
  margin: 0;
  border-radius: 15px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  line-height: normal;

  /* 原生 button 的默认边框要去掉，否则白卡外面多一圈灰 */
  &::after {
    border: none;
  }

  &--active {
    background: $subtle;
  }

  &__text {
    font-size: 12px;
    color: $muted;
  }
}
</style>
