<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onLoad, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app'
import type { Poll } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import { fetchPoll, fetchPollQrcode } from '@/api/poll'
import { formatDateTime } from '@/utils/format'
import { getPlatform } from '@/utils/platform'
import { buildShareMessage, buildTimelineMessage, syncShareMenu } from '@/utils/share'
import { cacheGet, cacheSet, cacheKey } from '@/utils/cache'

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
/** 后端生成的小程序码；拿不到时退回设计稿的占位点阵 */
const qrUrl = ref('')
/**
 * 生成中 / 生成失败要分开：
 * 都当「没有码」处理的话，进页面会先闪一下点阵占位再换成真码。
 * 生成中留白底，失败才显示占位图案。
 */
const qrLoading = ref(true)
const qrFailed = ref(false)
const saving = ref(false)

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

/** 分享页快照：投票信息 + 已生成的小程序码地址 */
interface ShareSnapshot {
  poll: Poll
  qrUrl: string
}

async function load() {
  const cached = cacheGet<ShareSnapshot>(cacheKey.pollShare(pollId.value))
  if (cached) {
    poll.value = cached.poll
    qrUrl.value = cached.qrUrl
    qrLoading.value = false
  }
  // 有快照就先渲染海报，骨架屏只在冷启动时出现
  loading.value = !cached
  failed.value = false
  try {
    poll.value = await fetchPoll(pollId.value)
    // 发起人关掉「允许分享」后，右上角菜单里的转发也一起收掉
    syncShareMenu(poll.value.rules.allowShare)
    // 码地址在 R2 里是稳定的，上次拿到过就不用再问一次
    if (cached?.qrUrl) cacheSet(cacheKey.pollShare(pollId.value), { poll: poll.value, qrUrl: qrUrl.value })
    else loadQrcode()
  } catch {
    // 有快照时静默失败，页面保持可看
    if (!poll.value) failed.value = true
  } finally {
    loading.value = false
  }
}

/** 小程序码单独请求：生成可能要一两秒，先让海报其余部分显示出来 */
async function loadQrcode() {
  qrLoading.value = true
  qrFailed.value = false
  try {
    qrUrl.value = await fetchPollQrcode(pollId.value)
    if (poll.value) {
      cacheSet(cacheKey.pollShare(pollId.value), { poll: poll.value, qrUrl: qrUrl.value })
    }
  } catch {
    // 没配 AppID / 没开 R2 / 网络问题都落到占位图案，不影响分享卡片
    qrFailed.value = true
  } finally {
    qrLoading.value = false
  }
}

onLoad((q) => {
  pollId.value = (q?.id as string) ?? ''
})
onMounted(load)

/** 邀请码单独复制一份，方便直接发文字给某个人 */
function copyCode() {
  if (!poll.value?.inviteCode) return
  uni.setClipboardData({
    data: poll.value.inviteCode,
    success: () => uni.showToast({ title: '邀请码已复制', icon: 'none' })
  })
}

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

/* ---------------- 海报保存 ----------------
 *
 * 页面上的海报是 DOM（能自适应宽度），保存要另画一张 canvas：
 * 固定 300×460 的画布，按设计稿的黑头 + 小程序码 + 署名的版式重绘，
 * 再导出 2 倍图存进相册。两者版式保持一致，用户看到什么就存什么。
 */

/** 标题按字数折行（中文按 1 字 ≈ 1 字号估算，够用且不用等 measureText） */
function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = []
  let rest = text
  while (rest && lines.length < maxLines) {
    lines.push(rest.slice(0, maxChars))
    rest = rest.slice(maxChars)
  }
  if (rest && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, maxChars - 1)}…`
  }
  return lines
}

function imageInfo(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.getImageInfo({ src, success: (r) => resolve(r.path), fail: reject })
  })
}

function renderPoster(qrPath: string): Promise<void> {
  return new Promise((resolve) => {
    const p = poll.value
    if (!p) {
      resolve()
      return
    }
    const W = 300
    const ctx = uni.createCanvasContext('poster')

    ctx.setFillStyle('#FFFFFF')
    ctx.fillRect(0, 0, W, 460)

    // 黑头：标题 + 截止时间
    ctx.setFillStyle('#09090B')
    ctx.fillRect(0, 0, W, 150)
    ctx.setFillStyle('#FFFFFF')
    ctx.setFontSize(20)
    wrapText(p.title, 12, 2).forEach((line, i) => ctx.fillText(line, 20, 46 + i * 28))
    ctx.setFillStyle('rgba(255,255,255,0.6)')
    ctx.setFontSize(11)
    ctx.fillText(deadlineText.value, 20, 128)

    // 小程序码
    ctx.drawImage(qrPath, (W - 140) / 2, 180, 140, 140)

    ctx.setTextAlign('center')
    ctx.setFillStyle('#71717A')
    ctx.setFontSize(12)
    ctx.fillText(scanText.value, W / 2, 348)

    ctx.setFillStyle('#A1A1AA')
    ctx.setFontSize(11)
    ctx.fillText(`由 ${p.creatorName} 发起`, W / 2, 382)

    ctx.setFillStyle('#4F46E5')
    ctx.setFontSize(12)
    ctx.fillText('杜雅轩 · 扫码参与', W / 2, 412)

    // 老版 canvas 的 draw 回调不保证图片已解码完，稍等一帧再导出
    ctx.draw(false, () => setTimeout(resolve, 150))
  })
}

function exportPoster(): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.canvasToTempFilePath({
      canvasId: 'poster',
      width: 300,
      height: 460,
      destWidth: 600,
      destHeight: 920,
      success: (r) => resolve(r.tempFilePath),
      fail: reject
    })
  })
}

function saveToAlbum(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    uni.saveImageToPhotosAlbum({ filePath, success: () => resolve(), fail: reject })
  })
}

async function savePoster() {
  if (!poll.value) return
  if (getPlatform() === 'h5') {
    uni.showToast({ title: '请在微信小程序里保存海报', icon: 'none' })
    return
  }
  if (!qrUrl.value) {
    uni.showToast({ title: '小程序码还没准备好，请稍后再试', icon: 'none' })
    return
  }
  if (saving.value) return
  saving.value = true
  try {
    const qrPath = await imageInfo(qrUrl.value)
    await renderPoster(qrPath)
    const filePath = await exportPoster()
    await saveToAlbum(filePath)
    uni.showToast({ title: '已保存到相册', icon: 'none' })
  } catch (err) {
    const msg = String((err as { errMsg?: string })?.errMsg ?? '')
    if (msg.includes('auth') || msg.includes('deny') || msg.includes('authorize')) {
      uni.showModal({
        title: '需要相册权限',
        content: '请在设置里允许「保存到相册」后再试',
        confirmText: '去设置',
        success: (r) => {
          if (r.confirm) uni.openSetting({})
        }
      })
    } else {
      uni.showToast({ title: '保存失败，请重试', icon: 'none' })
    }
  } finally {
    saving.value = false
  }
}

onShareAppMessage(() =>
  poll.value ? buildShareMessage(poll.value) : { title: '杜雅轩', path: '/pages/index/index' }
)
onShareTimeline(() => (poll.value ? buildTimelineMessage(poll.value) : { title: '杜雅轩' }))
</script>

<template>
  <view class="share">
    <!--
      隐藏画布：保存海报时在这里重绘。
      尺寸必须写在内联样式里 —— class 里的 px 会被 postcss 转成 rpx，
      不同机型上画布实际大小跟着变，而 ctx 的坐标是固定的 300×460，
      在小屏机上右下角就被裁掉了。
    -->
    <canvas canvas-id="poster" class="share__canvas" style="width: 300px; height: 460px" />

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
            <!-- 真小程序码；生成中留白底，失败才退回设计稿的点阵占位 -->
            <image
              v-if="qrUrl"
              class="poster__qr-img"
              :src="qrUrl"
              mode="aspectFit"
              show-menu-by-longpress
            />
            <view v-else-if="qrLoading" class="poster__qr-loading">
              <view class="poster__qr-spinner" />
            </view>
            <view v-else class="poster__qr">
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
            <text class="poster__scan">{{ qrFailed ? '小程序码生成失败，返回再试一次' : scanText }}</text>
          </view>

          <view class="poster__foot">
            <text class="poster__by">由 {{ poll.creatorName }} 发起</text>
          </view>
        </view>

        <!-- 邀请码模式：把码摆在明面上，转发文字/口头通知都能用 -->
        <view v-if="poll.inviteCode" class="invite">
          <view class="invite__left">
            <text class="invite__label">邀请码</text>
            <text class="invite__code">{{ poll.inviteCode }}</text>
          </view>
          <view class="invite__copy" hover-class="is-pressed" @tap="copyCode">
            <AppIcon name="copy" :size="14" color="#4F46E5" :stroke-width="2" />
            <text class="invite__copy-text">复制</text>
          </view>
        </view>

        <!-- 分享渠道：发起人关掉分享时整块收起来，海报仍然可以保存 -->
        <view v-if="poll.rules.allowShare" class="channels">
          <button class="channel" hover-class="channel--active" open-type="share" @tap="onWechat">
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

        <view v-if="poll.rules.allowShare" class="share__actions">
          <AppButton type="ink" size="compact" :disabled="saving" @tap="savePoster">
            {{ saving ? '正在保存…' : '保存到相册' }}
          </AppButton>
        </view>
        <text v-else class="share__closed">发起人已关闭这份{{ isSurvey ? '问卷' : '投票' }}的分享</text>
      </view>
    </scroll-view>
  </view>
</template>

<script lang="ts">
export default { name: 'SharePage' }
</script>

<style lang="scss" scoped>
.share {
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

  /* 画布只用来导出，不能 display:none —— 那样绘不出来，移出屏幕即可。
     宽高走内联样式，这里不要写，否则会被换算成 rpx */
  &__canvas {
    position: fixed;
    left: -9999px;
    top: 0;
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

  &__closed {
    font-size: 12px;
    color: $muted;
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

  /* 真码：白底、直角，四周留一点呼吸位 */
  &__qr-img {
    width: 140px;
    height: 140px;
    padding: 6px;
    background: #fff;
    box-sizing: border-box;
  }

  /* 生成中：和真码同尺寸的白框，避免出现「点阵 → 真码」的闪跳 */
  &__qr-loading {
    width: 140px;
    height: 140px;
    background: #fff;
    border: 1px solid $line;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__qr-spinner {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid $line;
    border-top-color: $accent;
    animation: qr-spin 0.8s linear infinite;
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

.invite {
  width: 100%;
  padding: 14px 16px;
  border-radius: 16px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  &__left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  &__label {
    font-size: 13px;
    color: $muted;
  }

  &__code {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 3px;
    color: $ink;
  }

  &__copy {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  &__copy-text {
    font-size: 13px;
    color: $accent;
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
  transition: background-color $dur-fast $ease-both;

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

@keyframes qr-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
