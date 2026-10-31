<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onLoad, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app'
import type { Poll } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppConfirmSheet from '@/components/base/AppConfirmSheet.vue'
import { fetchPoll, fetchPollQrcode, fetchInviteCode } from '@/api/poll'
import { formatDateTime } from '@/utils/format'
import { getPlatform } from '@/utils/platform'
import { ROUTES, reset } from '@/utils/router'
import { buildShareMessage, buildTimelineMessage, syncShareMenu } from '@/utils/share'
import { cacheGet, cacheSet, cacheDrop, cacheKey } from '@/utils/cache'
import {
  downloadQrImage,
  dropQrCache,
  isQrCacheStale,
  readQrCache,
  writeQrCache
} from '@/utils/qr-cache'
import type { QrCacheEntry } from '@/utils/qr-cache'
import { ApiError } from '@/utils/request'
import AppToast from '@/components/base/AppToast.vue'
import { toast } from '@/utils/toast'

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
/** 410：发起人删除了投票，链接/海报已经失效 */
const deleted = ref(false)
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
/** 保存海报时没有相册权限 */
const permissionVisible = ref(false)

function openAlbumSetting() {
  permissionVisible.value = false
  uni.openSetting({})
}

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

/**
 * 老数据可能还没生成邀请码：补一次，保证发起人能看到并单独发给参与者。
 * 非发起人调用会 403，静默失败即可，不影响海报和分享。
 */
async function loadInviteCode() {
  const p = poll.value
  if (!p || p.rules.joinMethod !== 'invite' || p.inviteCode) return
  try {
    const code = await fetchInviteCode(p.id)
    if (poll.value && code) poll.value.inviteCode = code
  } catch {
    // 忽略：没有码时页面只是不展示邀请码区块
  }
}

async function load() {
  const snapshot = cacheGet<ShareSnapshot>(cacheKey.pollShare(pollId.value))
  const qr = readQrCache(pollId.value)

  // 有内存快照就先渲染海报，骨架屏只在冷启动时出现
  if (snapshot) {
    poll.value = snapshot.poll
    qrUrl.value = snapshot.qrUrl
    qrLoading.value = false
    loadInviteCode()
  }

  // 本地码图比任何远端地址都快：有就直接用，不等 /qrcode
  if (qr) {
    qrUrl.value = qr.path
    qrLoading.value = false
  }

  loading.value = !snapshot
  failed.value = false
  deleted.value = false
  try {
    poll.value = await fetchPoll(pollId.value)
    loadInviteCode()
    // 发起人关掉「允许分享」后，右上角菜单里的转发也一起收掉
    syncShareMenu(poll.value.rules.allowShare)

    if (qr) {
      // 本地图已经显示出来了，后台确认一下地址有没有换过
      if (isQrCacheStale(qr)) revalidateQrcode(qr)
    } else if (qrUrl.value) {
      // 只有远端地址（旧快照 / 上次没存成）：补存一份，下次进页面就秒开
      void downloadQrImage(pollId.value, qrUrl.value)
    } else {
      loadQrcode()
    }

    // 快照里的投票信息用最新的覆盖；码地址仍记远端地址，本地路径只用于渲染
    if (snapshot) {
      cacheSet(cacheKey.pollShare(pollId.value), { poll: poll.value, qrUrl: qr?.url ?? qrUrl.value })
    }
  } catch (err) {
    // 已删除：海报和码都不能再展示
    if (err instanceof ApiError && (err.code === 404 || err.code === 410)) {
      cacheDrop(cacheKey.pollShare(pollId.value))
      dropQrCache(pollId.value)
      poll.value = null
      deleted.value = true
    } else if (!poll.value) {
      // 有快照时静默失败，页面保持可看
      failed.value = true
    }
  } finally {
    loading.value = false
  }
}

/** 小程序码单独请求：生成可能要一两秒，先让海报其余部分显示出来 */
async function loadQrcode() {
  qrLoading.value = true
  qrFailed.value = false
  try {
    const url = await fetchPollQrcode(pollId.value)
    qrUrl.value = url
    if (poll.value) {
      cacheSet(cacheKey.pollShare(pollId.value), { poll: poll.value, qrUrl: url })
    }
    // 存一份到本地，下次进页面直接读文件，不用再等网络
    void downloadQrImage(pollId.value, url)
  } catch {
    // 没配 AppID / 没开 R2 / 网络问题都落到占位图案，不影响分享卡片
    qrFailed.value = true
  } finally {
    qrLoading.value = false
  }
}

/**
 * 后台校验码地址。
 *
 * 地址没变：只刷新校验时间，什么都不用重画。
 * 地址变了（换了环境 / 样式）：重新下载，换成新图。
 * 请求失败：保持本地图不动 —— 后台失败不该把已经显示出来的码撤掉。
 */
async function revalidateQrcode(qr: QrCacheEntry) {
  try {
    const url = await fetchPollQrcode(pollId.value)
    if (url === qr.url) {
      writeQrCache(pollId.value, { ...qr, checkedAt: Date.now() })
      return
    }
    const path = await downloadQrImage(pollId.value, url)
    if (path) {
      qrUrl.value = path
    } else {
      // 新图没存下来：清掉旧缓存，避免下次又把旧环境的码顶上来
      dropQrCache(pollId.value)
      qrUrl.value = url
    }
    if (poll.value) {
      cacheSet(cacheKey.pollShare(pollId.value), { poll: poll.value, qrUrl: url })
    }
  } catch {
    // 静默：本地图还能用
  }
}

/**
 * 码图读不出来（本地文件被系统清了 / 远端地址失效）：
 * 本地文件先丢掉重走一次网络；远端地址也失败就落到占位提示，不再递归。
 */
function onQrError() {
  if (/^https?:/i.test(qrUrl.value)) {
    qrFailed.value = true
    return
  }
  dropQrCache(pollId.value)
  qrUrl.value = ''
  loadQrcode()
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
    success: () => toast.success('邀请码已复制')
  })
}

/** H5 / 抖音里没有微信分享面板，点了至少给个说法 */
function onWechat() {
  if (getPlatform() !== 'h5') return
  toast.show('请在微信小程序中分享')
}

function onTimeline() {
  toast.show('点右上角「···」分享到朋友圈')
}

function onMore() {
  toast.show('点右上角「···」转发给好友')
}

/* ---------------- 海报保存 ----------------
 *
 * 页面上的海报是 DOM（能自适应宽度），保存要另画一张 canvas：
 * 按 300 宽的设计稿重绘成和页面完全一致的版式（黑头 + 截止时间胶囊 +
 * 小程序码 + 灰底署名），再导出 1200px 宽的图，相册里放大也清楚。
 *
 * 老版 canvas 的坐标是逻辑像素，位图按「逻辑像素 × 屏幕像素密度」渲染，
 * canvasToTempFilePath 的 destWidth 也是物理像素。所以画布 CSS 宽取
 * 1200 / dpr：位图正好 1200 宽，导出 1:1 不放大也不缩，清晰且不浪费内存。
 * （直接画布 1200 CSS 宽的话，3 倍屏位图会到 3600，既慢又可能超出画布上限。）
 */

/** 海报设计宽度，和页面上 .poster 的 300 一致 */
const POSTER_W = 300
/** 导出目标宽度（物理像素） */
const POSTER_OUTPUT_W = 1200
/** 画布最大高度（两行标题时 379），固定画布避免运行时改尺寸 */
const POSTER_CANVAS_H = 380
/** 截止时间胶囊高度：上下 4 + 文字行高 15，和页面 flex 布局一致 */
const POSTER_CHIP_H = 4 + 15 + 4

const pixelRatio = Math.max(1, Number(uni.getSystemInfoSync().pixelRatio) || 1)
/**
 * 画布逻辑尺寸（CSS px）：物理位图 ≈ 1200 宽。
 * 下限 750 是给「旧版 canvas 位图不乘 DPR」的机型兜底 ——
 * 那些机型上导出 1200 是从 750 放大 1.6 倍，仍比原来 300 → 600 的 2 倍清晰。
 */
const POSTER_CANVAS_W = Math.max(Math.round(POSTER_OUTPUT_W / pixelRatio), 750)
/** 绘制缩放：设计稿 300 → 画布逻辑宽度 */
const POSTER_SCALE = POSTER_CANVAS_W / POSTER_W
const POSTER_CANVAS_MAX_H = POSTER_CANVAS_H * POSTER_SCALE

/**
 * 标题按实际字宽折行，和页面 .poster__title 的 260 内容宽一致
 * （中英文混排时按字数估会差很多，这里直接用 measureText）。
 * 最多 maxLines 行，放不下就在最后一行补省略号。
 */
function wrapText(
  ctx: UniApp.CanvasContext,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const chars = Array.from(text)
  const lines: string[] = []
  let line = ''
  let i = 0
  while (i < chars.length && lines.length < maxLines) {
    const next = line + chars[i]
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line)
      line = ''
      continue
    }
    line = next
    i += 1
  }
  if (line) lines.push(line)
  if (i < chars.length && lines.length) {
    let last = lines[lines.length - 1]
    while (last && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1)
    }
    lines[lines.length - 1] = `${last}…`
  }
  return lines
}

function imageInfo(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.getImageInfo({ src, success: (r) => resolve(r.path), fail: reject })
  })
}

/** 圆角矩形路径，用于截止时间胶囊 */
function roundRect(
  ctx: UniApp.CanvasContext,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

interface PosterLayout {
  lines: string[]
  headerH: number
  bodyH: number
  footH: number
  height: number
}

/** 版式尺寸全部按 300 宽的设计稿算，和页面上的 .poster 对齐 */
function posterLayout(ctx: UniApp.CanvasContext, title: string): PosterLayout {
  const lines = wrapText(ctx, title, POSTER_W - 40, 2)
  const lineCount = Math.max(1, lines.length)
  // 黑头：上下 20 + 标题（20 号 / 行高 1.35 → 27）+ 间距 12 + 胶囊 23
  const headerH = 20 + lineCount * 27 + 12 + POSTER_CHIP_H + 20
  // 白区：上下 20 + 二维码 140 + 间距 14 + 扫码文案（11 号 / 行高 1.5 → 17）
  const bodyH = 20 + 140 + 14 + 17 + 20
  // 灰底：上下 12 + 文字（10 号 / 行高 1.5 → 15）
  const footH = 12 + 15 + 12
  return { lines, headerH, bodyH, footH, height: headerH + bodyH + footH }
}

function renderPoster(qrPath: string): Promise<{ height: number }> {
  return new Promise((resolve) => {
    const p = poll.value
    if (!p) {
      resolve({ height: 0 })
      return
    }
    const ctx = uni.createCanvasContext('poster')
    // 折行要用真实字宽，先把标题字体设好再量
    ctx.font = 'bold 20px sans-serif'
    const layout = posterLayout(ctx, p.title)
    // 先整体放大，后面所有坐标都按 300 宽的设计稿写
    ctx.scale(POSTER_SCALE, POSTER_SCALE)

    // 白底
    ctx.setFillStyle('#FFFFFF')
    ctx.fillRect(0, 0, POSTER_W, layout.height)

    // 黑头
    ctx.setFillStyle('#09090B')
    ctx.fillRect(0, 0, POSTER_W, layout.headerH)

    // 标题
    ctx.setFillStyle('#FFFFFF')
    ctx.font = 'bold 20px sans-serif'
    ctx.setTextBaseline('top')
    layout.lines.forEach((line, i) => ctx.fillText(line, 20, 20 + i * 27))

    // 截止时间胶囊：和页面一样是 10% 白底 + 小时钟 + 10 号字
    const chipY = 20 + Math.max(1, layout.lines.length) * 27 + 12
    const chipH = POSTER_CHIP_H
    const label = deadlineText.value
    ctx.font = '10px sans-serif'
    const textW = ctx.measureText(label).width
    const iconW = 10
    const chipW = 9 + iconW + 4 + textW + 9
    roundRect(ctx, 20, chipY, chipW, chipH, 8)
    ctx.setFillStyle('rgba(255, 255, 255, 0.08)')
    ctx.fill()

    const iconCx = 20 + 9 + iconW / 2
    const iconCy = chipY + chipH / 2
    ctx.setStrokeStyle('rgba(255, 255, 255, 0.6)')
    ctx.setLineWidth(1)
    ctx.beginPath()
    ctx.arc(iconCx, iconCy, 4.5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(iconCx, iconCy)
    ctx.lineTo(iconCx, iconCy - 2.4)
    ctx.moveTo(iconCx, iconCy)
    ctx.lineTo(iconCx + 1.8, iconCy)
    ctx.stroke()

    ctx.setFillStyle('rgba(255, 255, 255, 0.8)')
    ctx.setTextBaseline('middle')
    ctx.fillText(label, 20 + 9 + iconW + 4, iconCy)

    // 小程序码：140 白框 + 6 内边距，和页面一致
    const qrX = (POSTER_W - 140) / 2
    const qrY = layout.headerH + 20
    ctx.setFillStyle('#FFFFFF')
    ctx.fillRect(qrX, qrY, 140, 140)
    ctx.drawImage(qrPath, qrX + 6, qrY + 6, 128, 128)

    // 扫码文案
    ctx.setTextAlign('center')
    ctx.setTextBaseline('top')
    ctx.setFillStyle('#52525B')
    ctx.font = '11px sans-serif'
    ctx.fillText(scanText.value, POSTER_W / 2, qrY + 140 + 14)

    // 灰底署名
    const footTop = layout.headerH + layout.bodyH
    ctx.setFillStyle('#F4F4F5')
    ctx.fillRect(0, footTop, POSTER_W, layout.footH)
    ctx.setTextAlign('left')
    ctx.setTextBaseline('middle')
    ctx.setFillStyle('#52525B')
    ctx.font = '10px sans-serif'
    ctx.fillText(`由 ${p.creatorName} 发起`, 20, footTop + layout.footH / 2)

    // 老版 canvas 的 draw 回调不保证图片已解码完，稍等一帧再导出
    ctx.draw(false, () => setTimeout(() => resolve({ height: layout.height }), 150))
  })
}

function exportPoster(height: number): Promise<string> {
  // 源区域用画布逻辑坐标；输出用物理像素，两者由 dpr 对齐，正好 1:1
  const canvasHeight = height * POSTER_SCALE
  const destHeight = Math.round((height / POSTER_W) * POSTER_OUTPUT_W)
  return new Promise((resolve, reject) => {
    uni.canvasToTempFilePath({
      canvasId: 'poster',
      x: 0,
      y: 0,
      width: POSTER_CANVAS_W,
      height: canvasHeight,
      destWidth: POSTER_OUTPUT_W,
      destHeight,
      fileType: 'png',
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

const NAME_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** 32 位随机文件名（大小写字母 + 数字） */
function randomFileName(): string {
  let name = ''
  for (let i = 0; i < 32; i++) {
    name += NAME_CHARS.charAt(Math.floor(Math.random() * NAME_CHARS.length))
  }
  return `${name}.png`
}

/**
 * 相册 API 不能直接指定文件名，临时文件在部分机型和开发者工具里会显示成
 * tmp_xxx。先把导出的图复制成 32 位随机名，再拿这个路径去存；复制失败就
 * 退回临时路径，不影响保存。
 */
function renameForAlbum(tempPath: string): string {
  const wxApi = (globalThis as any).wx
  const fs = wxApi?.getFileSystemManager?.() ?? (uni as any).getFileSystemManager?.()
  const dir = wxApi?.env?.USER_DATA_PATH ?? (uni as any).env?.USER_DATA_PATH
  if (!fs || !dir) return tempPath
  const target = `${dir}/${randomFileName()}`
  try {
    fs.copyFileSync(tempPath, target)
    return target
  } catch {
    return tempPath
  }
}

function removeTempFile(filePath: string): void {
  const wxApi = (globalThis as any).wx
  const fs = wxApi?.getFileSystemManager?.() ?? (uni as any).getFileSystemManager?.()
  if (!fs) return
  try {
    fs.unlink({ filePath, fail: () => {} })
  } catch {
    // 清理失败不影响用户
  }
}

async function savePoster() {
  if (!poll.value) return
  if (getPlatform() === 'h5') {
    toast.show('请在微信小程序里保存海报')
    return
  }
  if (!qrUrl.value) {
    toast.show('小程序码还没准备好，请稍后再试')
    return
  }
  if (saving.value) return
  saving.value = true
  try {
    const qrPath = await imageInfo(qrUrl.value)
    const { height } = await renderPoster(qrPath)
    const tempPath = await exportPoster(height)
    const albumPath = renameForAlbum(tempPath)
    try {
      await saveToAlbum(albumPath)
    } finally {
      if (albumPath !== tempPath) removeTempFile(albumPath)
    }
    toast.success('已保存到相册')
  } catch (err) {
    const msg = String((err as { errMsg?: string })?.errMsg ?? '')
    if (msg.includes('auth') || msg.includes('deny') || msg.includes('authorize')) {
      permissionVisible.value = true
    } else {
      toast.error('保存失败，请重试')
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
    <AppToast />
    <!--
      隐藏画布：保存海报时在这里重绘。
      尺寸必须写在内联样式里 —— class 里的 px 会被 postcss 转成 rpx，
      不同机型上画布实际大小跟着变，而 ctx 的坐标是按 300 宽设计稿固定的，
      在小屏机上右下角就被裁掉了。画布逻辑宽 = 1200 / dpr，导出 1200px。
    -->
    <canvas
      canvas-id="poster"
      class="share__canvas"
      :style="{
        width: `${POSTER_CANVAS_W}px`,
        height: `${POSTER_CANVAS_MAX_H}px`
      }"
    />

    <AppNavBar :title="navTitle" />

    <view v-if="loading" class="share__body">
      <AppSkeleton type="detail" />
    </view>

    <view v-else-if="deleted" class="share__body">
      <AppEmpty
        icon="trash-2"
        title="该投票已被发起人删除"
        desc="分享链接和海报都已经失效"
        action="返回首页"
        @action="reset(ROUTES.home)"
      />
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
              @error="onQrError"
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

        <!-- 邀请码模式：码不随链接/海报发出，由发起人单独告知参与者 -->
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

    <AppConfirmSheet
      :visible="permissionVisible"
      title="需要相册权限"
      desc="请在设置里允许「保存到相册」后再试"
      confirm-text="去设置"
      @close="permissionVisible = false"
      @confirm="openAlbumSetting"
    />
  </view>
</template>

<script lang="ts">
export default { name: 'SharePage' }
</script>

<style lang="scss" scoped>
.share {
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
    font-size: $fs-12;
    color: $muted;
  }
}

.poster {
  width: 300px;
  /* 320 宽的老机型上别顶出屏幕 */
  max-width: 100%;
  background: $surface;
  border: 1px solid $line;
  border-radius: $r-sheet;
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
    font-size: $fs-20;
    font-weight: 700;
    color: $white;
    line-height: 1.35;
  }

  &__meta {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  &__chip {
    padding: 4px 9px;
    border-radius: $r-chip;
    background: rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  &__chip-text {
    font-size: $fs-10;
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
    background: $white;
    box-sizing: border-box;
  }

  /* 生成中：和真码同尺寸的白框，避免出现「点阵 → 真码」的闪跳 */
  &__qr-loading {
    width: 140px;
    height: 140px;
    background: $white;
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
    font-size: $fs-11;
    color: $muted;
  }

  &__foot {
    padding: 12px 20px;
    background: $subtle;
    display: flex;
    align-items: center;
  }

  &__by {
    font-size: $fs-10;
    color: $muted;
  }
}

.invite {
  width: 100%;
  padding: 14px 16px;
  border-radius: $r-button;
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
    font-size: $fs-13;
    color: $muted;
  }

  &__code {
    font-size: $fs-18;
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
    font-size: $fs-13;
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
    font-size: $fs-12;
    color: $muted;
  }
}

@keyframes qr-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
