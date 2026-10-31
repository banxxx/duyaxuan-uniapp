<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { Poll, Comment } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppAvatar from '@/components/base/AppAvatar.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import AppActionSheet from '@/components/base/AppActionSheet.vue'
import {
  fetchPoll,
  fetchComments,
  createComment,
  deleteComment,
  setCommentLike
} from '@/api/poll'
import { useUserStore } from '@/stores/user'
import { formatRelative } from '@/utils/format'
import { bottomInset, getSafeArea } from '@/utils/platform'
import { cacheGet, cacheSet, cacheKey } from '@/utils/cache'
import AppToast from '@/components/base/AppToast.vue'

/**
 * 26 评论 · 讨论区（投票）/ 79 评论 · 讨论区（问卷）
 *
 * 两屏结构完全一样，只有置顶那条的文案不同：
 *   投票 → 「投票截止后会在这里公布最终结果」
 *   问卷 → 「问卷截止后会在这里关闭讨论」
 * 所以合成一页，按 poll.type 换文案。
 *
 * 三个筛选：最新 / 最热 / 我参与的。「我参与的」按后端返回的 isMine 过滤，
 * 匿名浏览时没有 isMine，这里回退到和当前用户 id 比较。
 */
const userStore = useUserStore()

const poll = ref<Poll | null>(null)
const comments = ref<Comment[]>([])
const loading = ref(true)
const loadError = ref(false)
/** 评论分页：滚动到底继续取下一页 */
const cursor = ref<string | null>(null)
const hasMore = ref(false)
const loadingMore = ref(false)
const tab = ref<'latest' | 'hot' | 'mine'>('latest')
const draft = ref('')
const sending = ref(false)
const pollId = ref('')
/**
 * 回复谁：不单独显示「回复 xx」提示条，也不把 @某人 真的写进输入框 ——
 * 只在 placeholder 里用灰字显示 @某人，一开始打字就自然消失。
 * 提交时带 replyToId，列表里会显示成「回复 @xx」。
 */
const replyTo = ref<{ id: string; name: string } | null>(null)

/** 长按评论弹出的操作菜单 */
const actionVisible = ref(false)
const actionComment = ref<Comment | null>(null)

/** 输入框焦点：点「回复」后把光标送回输入框 */
const composerFocus = ref(false)

/**
 * 键盘高度。
 *
 * 页面是 100vh 的固定布局，键盘弹起时整页不会自己让位，输入栏就会被挡住 ——
 * 所以自己监听键盘高度，把输入栏（和全屏编辑框）整条抬起来。
 */
const keyboardHeight = ref(0)

/** 放大后的编辑框（输入框右侧的「放大」） */
const editorOpen = ref(false)
const editorFocus = ref(false)
/** 收起中：等键盘收完再卸载 textarea，避免原生层残留（见 closeEditor） */
const editorClosing = ref(false)
let closeTimer: ReturnType<typeof setTimeout> | null = null
/** 收起瞬间冻结编辑框尺寸，键盘回落时不再来回改 textarea 高度 */
const closingInset = ref(0)
const closingInputHeight = ref('')

const { statusBarHeight, navBarHeight, capsuleInset, safeBottom } = getSafeArea()

/**
 * 放大后的编辑框铺满整屏（和 B 站的全屏输入一样），高度按窗口实际尺寸算：
 * 顶部是一条和导航栏等高的工具行（放下收起键，顺便让开右上角系统胶囊），
 * 底部扣掉键盘（或安全区）和一条工具条。
 *
 * 注意：收起键必须放在 textarea 的盒子外面。textarea 是原生组件，
 * 层级高于普通 view，叠在它上面的按钮在部分安卓机上收不到点击 ——
 * 之前点收起没反应就是这个原因，所以这里单独给它一行，而不是绝对定位盖上去。
 *
 * 样式里的 px 构建时会按 390 设计稿换算成 rpx，所以工具条高度这里也要
 * 用同一个系数换算成设备 px，否则文字框会差出几十像素。
 */
const winInfo = (() => {
  try {
    return uni.getSystemInfoSync() as { windowHeight?: number; windowWidth?: number }
  } catch {
    return {}
  }
})()
const windowHeight = winInfo.windowHeight ?? 667
const designScale = (winInfo.windowWidth ?? 375) / 390
const EDITOR_FOOT_H = 56 * designScale

const editorInputHeight = computed(() => {
  // 键盘弹起时让开键盘，收起时让开底部小横条
  const bottom = keyboardHeight.value > 0 ? keyboardHeight.value : safeBottom
  return `${Math.max(160, windowHeight - statusBarHeight - navBarHeight - bottom - EDITOR_FOOT_H)}px`
})

/** 工具行右侧要给系统胶囊让位，和 AppNavBar 用同一套算法 */
const editorHeadPadding = computed(() => `${Math.max(capsuleInset, 20)}px`)

/** 有正文才允许发送；空输入框（只剩灰色 @ 占位）按空处理 */
const canSend = computed(() => !!draft.value.trim())

/** 回复时的灰色占位文案：@某人，输入文字后由 placeholder 自动消失 */
const replyPlaceholder = computed(() => `@${replyTo.value?.name ?? ''}`)

/** 输入栏底部留白：键盘弹起时让开键盘，收起时退回安全区 */
const composerInset = computed(() =>
  keyboardHeight.value > 0 ? `${keyboardHeight.value}px` : bottomInset(20)
)

function onKeyboard(res: { height: number }) {
  keyboardHeight.value = res.height
  // 收起过程中键盘高度归零 = 动画结束，这时再卸载 textarea 才安全
  if (editorClosing.value && res.height === 0) finishClose()
}

/** 放大：开全屏编辑框，焦点交给里面的 textarea */
function openEditor() {
  // 上一轮收起还没走完又点开了，取消掉，别把新开的编辑框关掉
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
  editorClosing.value = false
  editorOpen.value = true
  // 底部输入框别再抢焦点，焦点交给全屏编辑框
  composerFocus.value = false
  nextTick(() => {
    // 微信里紧接着聚焦偶尔弹不出键盘，隔一帧再点一次
    setTimeout(() => {
      editorFocus.value = true
    }, 60)
  })
}

/**
 * 收起时的顺序很关键：
 *
 * textarea 是原生组件，键盘还弹着就把它 v-if 卸载，微信会在屏幕上留一层
 * 看不见的原生层，之后整页都点不动（看起来就是「卡住了」）。
 * 所以先失焦、收键盘，等键盘真正收完（onKeyboard 高度归零）再卸载；
 * 个别机型不回调高度变化，用 400ms 兜底。
 */
function finishClose() {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
  if (!editorClosing.value) return
  editorClosing.value = false
  editorOpen.value = false
}

function closeEditor() {
  if (!editorOpen.value || editorClosing.value) return
  editorClosing.value = true
  // 冻结当前尺寸：原生 textarea 收起过程中反复重排，最容易卡住
  closingInset.value = keyboardHeight.value > 0 ? keyboardHeight.value : safeBottom
  closingInputHeight.value = editorInputHeight.value
  // 有些端不支持键盘高度回调，用「编辑框刚刚还在聚焦」当作键盘可能弹着的信号
  const keyboardLikelyUp = keyboardHeight.value > 0 || editorFocus.value
  editorFocus.value = false
  // 收起键盘时把下面的输入框焦点也放掉，免得编辑器关了焦点又被抢回去
  composerFocus.value = false
  // 等失焦真正生效再收键盘，避免「失焦」和「收键盘」同时打到原生组件上
  nextTick(() => {
    try {
      uni.hideKeyboard()
    } catch {
      /* 非小程序端没有这个 API */
    }
  })
  // 键盘没弹：留一帧让失焦先生效；弹着就等键盘收完（高度归零），最多 400ms 兜底
  closeTimer = setTimeout(finishClose, keyboardLikelyUp ? 400 : 60)
}

/** 点「回复」后聚焦输入框：小程序里 focus 要先复位再置 true 才会重新弹键盘 */
function focusComposer() {
  composerFocus.value = false
  nextTick(() => {
    setTimeout(() => {
      composerFocus.value = true
    }, 30)
  })
}

/** 全屏编辑框里发送：成功才关掉，失败留在原地继续改 */
async function sendFromEditor() {
  if (editorClosing.value) return
  if (await send()) closeEditor()
}

/** 一条顶层评论 + 它下面的回复 */
interface Thread {
  root: Comment
  replies: Comment[]
}

/** 一次「展开」放几条回复：楼层回复多了分批放，别一下铺满屏幕 */
const REPLY_BATCH = 10

/**
 * 每个楼层当前露出几条回复。
 *
 * 默认一条都不露（表里没有这个楼层就是 0），点「展开全部」才一批批放出来，
 * 收起时直接删掉这一项，回到全隐藏。
 */
const shownReplies = ref(new Map<string, number>())

function replyCount(id: string): number {
  return shownReplies.value.get(id) ?? 0
}

function isMineComment(c: Comment): boolean {
  const me = userStore.profile?.id
  return !!c.isMine || (!!me && c.user.id === me)
}

/**
 * 按楼层分组（两级，和 B 站一样）。
 *
 * 接口给的是一张扁平的表，回复只记了 replyToId。这里沿 replyToId 往上走，
 * 找到它所属的顶层评论挂上去；回复别人的回复也落在同一个楼层下，
 * 靠「回复 @某某」标出具体对象 —— 不做无限嵌套，手机上缩进两层就没地方了。
 * 父评论被删 / 不在这一页里时，这条自己当顶层，不会丢。
 */
const threads = computed<Thread[]>(() => {
  const byId = new Map(comments.value.map((c) => [c.id, c]))
  const roots: Comment[] = []
  const children = new Map<string, Comment[]>()

  /** 顺着 replyToId 往上走，拿到所属楼层的 id */
  function rootIdOf(c: Comment): string {
    let cur = c
    const seen = new Set([c.id])
    while (cur.replyToId) {
      const parent = byId.get(cur.replyToId)
      if (!parent || seen.has(parent.id)) break
      seen.add(parent.id)
      cur = parent
    }
    return cur.id
  }

  for (const c of comments.value) {
    const rid = rootIdOf(c)
    if (rid === c.id) {
      roots.push(c)
    } else {
      const list = children.get(rid)
      if (list) list.push(c)
      else children.set(rid, [c])
    }
  }

  let list = roots
  // 最新 / 最热：服务端已经按对应顺序返回，这里保持原顺序；
  // 我参与的：只在已加载的评论里过滤（往下翻会继续套用这个过滤）
  if (tab.value === 'mine') {
    // 我发起的楼层 + 我在别人楼层下的回复，都算「我参与的」
    list = list.filter((r) => isMineComment(r) || (children.get(r.id) ?? []).some(isMineComment))
  }

  return list.map((root) => ({
    root,
    // 回复按时间正序，像聊天记录一样从旧到新
    replies: (children.get(root.id) ?? []).sort((a, b) => a.createdAt - b.createdAt)
  }))
})

/** 楼层下当前该显示哪些回复 */
function visibleReplies(t: Thread): Comment[] {
  return t.replies.slice(0, replyCount(t.root.id))
}

/** 展开下一批；已经全展开了就整层收起 */
function toggleReplies(t: Thread) {
  const shown = replyCount(t.root.id)
  const next = new Map(shownReplies.value)
  if (shown >= t.replies.length) next.delete(t.root.id)
  else next.set(t.root.id, Math.min(shown + REPLY_BATCH, t.replies.length))
  shownReplies.value = next
}

/**
 * 展开按钮上的字。
 *
 * 收起状态沿用原来那句「展开全部 N 条回复」；展开到一半报还剩多少；
 * 全展开后才是「收起回复」—— 收起是一下收干净，不分批。
 */
function moreLabel(t: Thread): string {
  const shown = replyCount(t.root.id)
  if (!shown) return `展开全部 ${t.replies.length} 条回复`
  if (shown < t.replies.length) return `展开剩余 ${t.replies.length - shown} 条回复`
  return '收起回复'
}

/** 自己刚发的回复：直接把这个楼层全展开，否则发完看不见自己的 */
function revealThread(t: Thread) {
  const next = new Map(shownReplies.value)
  next.set(t.root.id, t.replies.length)
  shownReplies.value = next
}

/*
 * 长评论折叠
 *
 * 500 字的评论整条铺开会把一屏占满，所以正文先只露几行，点「展开全文」再看。
 * 小程序里量不到文本实际行数，这里按「一行大概几个汉字」估算截断位置：
 * 汉字/全角按 1、英文数字按 0.55、emoji 按 2，显式换行照算。
 *
 * 折叠状态和「展开全部 N 条回复」用的 shownReplies 是两套独立状态：
 * 一个控制单条正文露多少字，一个控制楼层下露几条回复，互不干扰。
 */
const ROOT_FOLD_LINES = 4
const ROOT_FOLD_COLS = 22
const REPLY_FOLD_LINES = 4
const REPLY_FOLD_COLS = 19

/** 单个字符占几个汉字宽（用来估算换行） */
function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  if (code > 0xffff) return 2 // emoji 等增补字符
  return code < 0x2e80 ? 0.55 : 1 // 英文、数字、半角符号
}

interface FoldedText {
  text: string
  folded: boolean
}

/** 按行数上限截断正文，放不下时截到最后一个完整字符并补省略号 */
function foldText(source: string, cols: number, maxLines: number): FoldedText {
  const chars = Array.from(source)
  let lines = 1
  let width = 0
  let cut = 0
  for (; cut < chars.length; cut++) {
    const ch = chars[cut]
    if (ch === '\n') {
      lines += 1
      width = 0
      if (lines > maxLines) break
      continue
    }
    const w = charWidth(ch)
    if (width + w > cols) {
      lines += 1
      width = w
      if (lines > maxLines) break
    } else {
      width += w
    }
  }
  if (cut >= chars.length) return { text: source, folded: false }
  return { text: `${chars.slice(0, cut).join('').replace(/[\s\n]+$/, '')}…`, folded: true }
}

/** 这条评论按楼层正文（13px）显示时要不要折叠 */
function rootFold(c: Comment): FoldedText {
  return foldText(c.content, ROOT_FOLD_COLS, ROOT_FOLD_LINES)
}

/** 这条评论按回复正文（12px、更窄）显示时要不要折叠 */
function replyFold(c: Comment): FoldedText {
  return foldText(c.content, REPLY_FOLD_COLS, REPLY_FOLD_LINES)
}

/** 展开过全文的评论 id（和回复展开状态彼此独立） */
const expandedText = ref(new Set<string>())

function isTextExpanded(id: string): boolean {
  return expandedText.value.has(id)
}

function toggleText(id: string) {
  const next = new Set(expandedText.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedText.value = next
}

/** 正文显示什么：展开后给全文，否则给截断结果 */
function rootText(c: Comment): string {
  return isTextExpanded(c.id) ? c.content : rootFold(c).text
}

function replyText(c: Comment): string {
  return isTextExpanded(c.id) ? c.content : replyFold(c).text
}

const pinned = computed(() => {
  const p = poll.value
  if (!p) return ''
  return p.type === 'survey'
    ? '问卷截止后会在这里关闭讨论，感谢大家的参与！'
    : '投票截止后会在这里公布最终结果，感谢大家的参与！'
})

/** 讨论区快照：投票基础信息 + 评论列表，再进页面时一起恢复 */
interface CommentsSnapshot {
  poll: Poll
  comments: Comment[]
}

function saveSnapshot() {
  if (poll.value) cacheSet(cacheKey.pollComments(pollId.value), { poll: poll.value, comments: comments.value })
}

async function load() {
  const cached = cacheGet<CommentsSnapshot>(cacheKey.pollComments(pollId.value))
  if (cached) {
    poll.value = cached.poll
    comments.value = cached.comments
  }
  // 有快照就不再进骨架屏，下面的请求只是把内容刷新到最新
  loading.value = !cached
  loadError.value = false
  try {
    poll.value = await fetchPoll(pollId.value)
    await loadComments(true)
    saveSnapshot()
  } catch {
    // 加载失败时 poll 是空的，不能让它掉进「发起人已关闭评论」的分支
    if (!poll.value) loadError.value = true
  } finally {
    loading.value = false
  }
}

/** 按当前 tab 取评论；latest/hot 由服务端排序并分页，mine 只在已加载里过滤 */
async function loadComments(reset: boolean) {
  if (loadingMore.value) return
  loadingMore.value = true
  try {
    const sort = tab.value === 'hot' ? 'hot' : 'latest'
    const page = await fetchComments(pollId.value, { cursor: reset ? null : cursor.value, sort })
    const seen = new Set(comments.value.map((c) => c.id))
    comments.value = reset
      ? page.list
      : [...comments.value, ...page.list.filter((c) => !seen.has(c.id))]
    cursor.value = page.cursor
    hasMore.value = page.hasMore
  } catch {
    // 失败原因由请求层统一 toast，这里不再重复
  } finally {
    loadingMore.value = false
  }
}

/** 滚到底加载下一页，按 id 去重，避免翻页间隙新评论挤进来造成重复 */
function loadMore() {
  if (hasMore.value) loadComments(false)
}

/** 切换 tab：latest/hot 重新从第一页按服务端排序拉，mine 只做本地过滤 */
function setTab(key: 'latest' | 'hot' | 'mine') {
  if (tab.value === key) return
  tab.value = key
  shownReplies.value = new Map()
  comments.value = []
  cursor.value = null
  hasMore.value = false
  loadComments(true)
}

onLoad((q) => {
  pollId.value = (q?.id as string) ?? ''
})
onMounted(load)

onMounted(() => {
  try {
    uni.onKeyboardHeightChange(onKeyboard)
  } catch {
    // 不支持的端（比如 H5）交给浏览器自己把输入框滚进可视区
  }
})

onUnmounted(() => {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
  try {
    uni.offKeyboardHeightChange(onKeyboard)
  } catch {
    /* 同上 */
  }
})

/** 发评论；返回是否成功，全屏编辑框据此决定关不关 */
async function send(): Promise<boolean> {
  const text = draft.value.trim()
  if (!text || sending.value) return false
  sending.value = true
  try {
    const created = await createComment(pollId.value, text, replyTo.value?.id)
    comments.value.unshift(created)
    // 落在收起的楼层里就整个展开，否则用户看不到自己刚发的那条
    const t = threads.value.find(
      (x) => x.root.id === created.id || x.replies.some((r) => r.id === created.id)
    )
    if (t) revealThread(t)
    if (poll.value) poll.value.commentCount = (poll.value.commentCount ?? 0) + 1
    draft.value = ''
    replyTo.value = null
    saveSnapshot()
    return true
  } catch {
    // 失败提示已由请求层弹出，这里只保留草稿，别让用户白打一遍
    return false
  } finally {
    sending.value = false
  }
}

/** 点赞：先改本地让反馈即时，失败再回滚（toast 由请求层弹出） */
async function like(c: Comment) {
  const next = !c.liked
  const before = { liked: c.liked, likeCount: c.likeCount }
  c.liked = next
  c.likeCount = Math.max(0, c.likeCount + (next ? 1 : -1))
  try {
    const res = await setCommentLike(pollId.value, c.id, next)
    c.liked = res.liked
    c.likeCount = res.likeCount
  } catch {
    c.liked = before.liked
    c.likeCount = before.likeCount
  }
  saveSnapshot()
}

function reply(c: Comment) {
  // 只换回复目标：@某人 走灰色占位，不碰已经打了一半的正文
  replyTo.value = { id: c.id, name: c.user.name }
  focusComposer()
}

/** 长按删除：作者本人或发起人 */
function onLongPress(c: Comment) {
  const me = userStore.profile?.id
  const canDelete = c.isMine || (!!me && poll.value?.creatorId === me)
  if (!canDelete) return
  actionComment.value = c
  actionVisible.value = true
}

async function onCommentAction(key: string) {
  const c = actionComment.value
  if (!c || key !== 'delete') return
  try {
    await deleteComment(pollId.value, c.id)
  } catch {
    return
  }
  // 只删这一条：下面的回复是别人的话，不跟着一起没了，
  // 它们会在下次分组时自己升成楼层（带「回复 xx」前缀）
  comments.value = comments.value.filter((x) => x.id !== c.id)
  if (poll.value) poll.value.commentCount = Math.max(0, (poll.value.commentCount ?? 0) - 1)
  saveSnapshot()
}
</script>

<template>
  <view class="comments">
    <AppToast />
    <AppNavBar title="讨论区" />

    <view v-if="loading" class="comments__body">
      <AppSkeleton type="people" />
    </view>

    <AppEmpty
      v-else-if="loadError"
      icon="wifi-off"
      title="加载失败"
      desc="网络不太稳定，重试一下就好"
      action="重新加载"
      action-icon="refresh-cw"
      @action="load"
    />

    <template v-else>
      <scroll-view class="comments__scroll" scroll-y @scrolltolower="loadMore">
        <view class="comments__list">
          <!-- 筛选：设计稿 26 用同一套分段控件（$subtle 轨道 + 白色选中块） -->
          <view class="tabs">
            <view
              v-for="t in [
                { key: 'latest', label: '最新' },
                { key: 'hot', label: '最热' },
                { key: 'mine', label: '我参与的' }
              ]"
              :key="t.key"
              class="tabs__item"
              :class="{ 'tabs__item--on': tab === t.key }"
              @tap="setTab(t.key as any)"
            >
              <text class="tabs__text" :class="{ 'tabs__text--on': tab === t.key }">{{ t.label }}</text>
            </view>
          </view>

          <text v-if="tab === 'mine'" class="tabs__hint">
            只在已加载的评论里筛选，向下滚动可加载更多
          </text>

          <!-- 发起人置顶 -->
          <view class="pinned">
            <view class="pinned__head">
              <AppIcon name="pin" :size="13" color="#4F46E5" :stroke-width="2" />
              <text class="pinned__name">发起人 · {{ poll?.creatorName }}</text>
            </view>
            <text class="pinned__text">{{ pinned }}</text>
          </view>

          <view v-for="t in threads" :key="t.root.id" class="thread">
            <!-- 楼层：顶层评论。昵称单独一行，时间挪到底部 —— 和 B 站一样，头部不再挂两段信息 -->
            <view class="comment" @longpress="onLongPress(t.root)">
              <AppAvatar :src="t.root.user.avatar" :name="t.root.user.name" :size="34" />
              <view class="comment__body">
                <text class="comment__name">{{ t.root.user.name }}</text>

                <!-- 只在「找不到所属楼层」时出现：父评论被删了，或者服务端还是旧版本 -->
                <text v-if="t.root.replyTo" class="comment__reply">
                  回复 {{ t.root.replyTo.name }}：
                </text>
                <text class="comment__text">{{ rootText(t.root) }}</text>
                <!-- 长评论先折叠，展开/收起只影响这一条正文，不动楼层的回复展开状态 -->
                <text
                  v-if="rootFold(t.root).folded"
                  class="comment__fold"
                  @tap="toggleText(t.root.id)"
                >{{ isTextExpanded(t.root.id) ? '收起' : '展开全文' }}</text>

                <view class="comment__foot">
                  <text class="comment__time">{{ formatRelative(t.root.createdAt) }}</text>
                  <view class="comment__ops">
                    <view class="comment__op" @tap="reply(t.root)">
                      <AppIcon name="message-square" :size="13" color="#A1A1AA" />
                    </view>
                    <view class="comment__op" @tap="like(t.root)">
                      <AppIcon name="heart" :size="13" :color="t.root.liked ? '#4F46E5' : '#A1A1AA'" />
                      <text
                        v-if="t.root.likeCount"
                        class="comment__op-count"
                        :class="{ 'comment__op-count--on': t.root.liked }"
                      >{{ t.root.likeCount }}</text>
                    </view>
                  </view>
                </view>
              </view>
            </view>

            <!-- 有回复但没展开：只留一行缩进的入口，和 B 站一样不占灰底块 -->
            <view
              v-if="t.replies.length && !replyCount(t.root.id)"
              class="replies-more"
              @tap="toggleReplies(t)"
            >
              <text class="replies-more__text">{{ moreLabel(t) }}</text>
              <AppIcon name="chevron-down" :size="12" color="#4F46E5" />
            </view>

            <!-- 展开后：灰底块缩进到正文位置，回复按批次放出来 -->
            <view v-else-if="t.replies.length" class="replies">
              <view
                v-for="r in visibleReplies(t)"
                :key="r.id"
                class="reply"
                @longpress="onLongPress(r)"
              >
                <AppAvatar :src="r.user.avatar" :name="r.user.name" :size="24" />
                <view class="reply__body">
                  <view class="reply__top">
                    <text class="reply__name">{{ r.user.name }}</text>
                    <text v-if="r.replyTo" class="reply__to">回复 @{{ r.replyTo.name }}</text>
                  </view>

                  <text class="reply__text">{{ replyText(r) }}</text>
                  <!-- 长回复先折叠，展开/收起只影响这一条，不动下面的回复批次 -->
                  <text
                    v-if="replyFold(r).folded"
                    class="comment__fold"
                    @tap="toggleText(r.id)"
                  >{{ isTextExpanded(r.id) ? '收起' : '展开全文' }}</text>

                  <view class="reply__foot">
                    <text class="reply__time">{{ formatRelative(r.createdAt) }}</text>
                    <view class="reply__ops">
                      <view class="comment__op" @tap="reply(r)">
                        <AppIcon name="message-square" :size="12" color="#A1A1AA" />
                      </view>
                      <view class="comment__op" @tap="like(r)">
                        <AppIcon name="heart" :size="12" :color="r.liked ? '#4F46E5' : '#A1A1AA'" />
                        <text
                          v-if="r.likeCount"
                          class="comment__op-count"
                          :class="{ 'comment__op-count--on': r.liked }"
                        >{{ r.likeCount }}</text>
                      </view>
                    </view>
                  </view>
                </view>
              </view>

              <view class="replies__more" @tap="toggleReplies(t)">
                <text class="replies__more-text">{{ moreLabel(t) }}</text>
                <AppIcon
                  :name="replyCount(t.root.id) === t.replies.length ? 'chevron-up' : 'chevron-down'"
                  :size="12"
                  color="#4F46E5"
                />
              </view>
            </view>
          </view>

          <AppEmpty
            v-if="!threads.length"
            icon="message-square"
            :title="tab === 'mine' ? '你还没有发言' : '还没有人评论'"
            desc="说说你的想法，让发起人看到"
          />

          <text v-if="threads.length && loadingMore" class="comments__more">加载更多…</text>
          <text v-else-if="threads.length && !hasMore" class="comments__more">没有更多了</text>
        </view>
      </scroll-view>

      <!-- 输入栏：键盘弹起时整条抬起来，靠 composerInset 让出键盘高度 -->
      <view v-if="poll?.rules.allowComment" class="composer" :style="{ paddingBottom: composerInset }">
        <view class="composer__row">
          <!-- 输入框就是一个细长胶囊，右侧内嵌放大键 —— 和截图里的常态输入一致 -->
          <view class="composer__field">
            <input
              v-model="draft"
              class="composer__input"
              :placeholder="replyTo ? replyPlaceholder : '说点什么…'"
              placeholder-class="composer__ph"
              confirm-type="send"
              maxlength="500"
              :focus="composerFocus"
              :adjust-position="false"
              :cursor-spacing="0"
              @confirm="send"
              @blur="composerFocus = false"
            />
            <!-- 放大：没写字时压暗，写了字点亮；点开全屏编辑框 -->
            <view
              class="composer__expand"
              :class="{ 'composer__expand--on': canSend }"
              @tap="openEditor"
            >
              <AppIcon name="maximize-2" :size="14" :color="canSend ? '#4F46E5' : '#A1A1AA'" />
            </view>
          </view>
          <!-- 发送：圆角胶囊，空内容时灰底，和截图里的「发布」位置一致 -->
          <view
            class="composer__send"
            :class="{ 'composer__send--on': canSend, 'composer__send--busy': sending }"
            @tap="send"
          >
            <text class="composer__send-text" :class="{ 'composer__send-text--on': canSend }">发送</text>
          </view>
        </view>
      </view>

      <view v-else class="closed-bar" :style="{ paddingBottom: bottomInset(14) }">
        <text class="closed-bar__text">发起人已关闭评论</text>
      </view>

      <!--
        放大后的编辑框：整屏白底（和截图里的全屏输入一致）。
        顶部是一条和导航栏等高的工具行：收起键在系统胶囊左边、单独占一行，
        不会和原生 textarea 叠在一起；底部工具条贴在键盘上沿。
      -->
      <view
        v-if="editorOpen"
        class="editor"
        :style="{
          paddingTop: statusBarHeight + 'px',
          paddingBottom: (editorClosing ? closingInset : keyboardHeight > 0 ? keyboardHeight : safeBottom) + 'px'
        }"
      >
        <!-- 工具行：收起键放在这里，单独占一行，不会和原生 textarea 叠在一起 -->
        <view
          class="editor__head"
          :style="{ height: navBarHeight + 'px', paddingRight: editorHeadPadding }"
        >
          <view class="editor__collapse" @tap="closeEditor">
            <AppIcon name="minimize-2" :size="18" color="#71717A" />
          </view>
        </view>

        <textarea
          v-model="draft"
          class="editor__input"
          :style="{ height: editorClosing ? closingInputHeight : editorInputHeight }"
          :focus="editorFocus"
          :maxlength="500"
          :adjust-position="false"
          :show-confirm-bar="false"
          :disable-default-padding="true"
          :cursor-spacing="16"
          :placeholder="replyTo ? replyPlaceholder : '说点什么…'"
          placeholder-class="editor__ph"
        />

        <view class="editor__foot">
          <text class="editor__count" :class="{ 'editor__count--max': draft.length >= 500 }">
            {{ draft.length }}/500
          </text>
          <view
            class="editor__send"
            :class="{ 'editor__send--on': canSend, 'editor__send--busy': sending }"
            @tap="sendFromEditor"
          >
            <text class="editor__send-text" :class="{ 'editor__send-text--on': canSend }">发送</text>
          </view>
        </view>
      </view>
    </template>

    <!-- 长按评论：删除 -->
    <AppActionSheet
      :visible="actionVisible"
      title="评论操作"
      :items="[{ key: 'delete', label: '删除评论', icon: 'trash-2', danger: true }]"
      @close="actionVisible = false"
      @select="onCommentAction"
    />
  </view>
</template>

<script lang="ts">
export default { name: 'PollCommentsPage' }
</script>

<style lang="scss" scoped>
.comments {
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

  /* 设计稿 26：Content gap 12、padding [4,20,16,20]。
     楼层之间是 gap 12 + 分隔线 + padding-top 12，比原来紧一档 */
  &__list {
    padding: 4px $gutter 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  &__more {
    padding: 6px 0 2px;
    font-size: $fs-11;
    color: $faint;
    text-align: center;
  }
}

/* 分段：设计稿 26 与 15/44 同一套 */
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

    &--on {
      background: $surface;
    }
  }

  &__text {
    font-size: $fs-12;
    font-weight: 500;
    color: $muted;

    &--on {
      color: $ink;
      font-weight: 600;
    }
  }

  &__hint {
    font-size: $fs-10;
    color: $faint;
    line-height: 1.5;
  }
}

/* 发起人置顶：$accent-soft、圆角 12、内边距 14 */
.pinned {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  background: $accent-soft;
  border-radius: $r-md;

  &__head {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  &__name {
    font-size: $fs-11;
    font-weight: 600;
    color: $accent;
  }

  &__text {
    font-size: $fs-12;
    color: $ink;
    line-height: 1.55;
  }
}

/* 楼层：一条顶层评论 + 它下面的回复，楼层之间一条通栏细线 */
.thread {
  & + & {
    border-top: 1px solid $line;
    padding-top: 12px;
  }
}

/* 评论行：头像 34、行距 10；昵称、正文、时间/操作三行 */
.comment {
  display: flex;
  gap: 10px;

  &__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  &__name {
    font-size: $fs-12;
    font-weight: 600;
    color: $ink;
    line-height: 1.4;
  }

  &__reply {
    font-size: $fs-11;
    color: $accent-ink;
  }

  &__text {
    font-size: $fs-13;
    color: $ink;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* 「展开全文 / 收起」：贴在正文下方，和回复批次入口分开 */
  &__fold {
    align-self: flex-start;
    padding: 1px 0;
    font-size: $fs-11;
    font-weight: 500;
    color: $accent;
    line-height: 1.4;
  }

  /* 时间在左、操作在右：头部只剩名字，视觉上少一层 */
  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 1px;
  }

  &__time {
    font-size: $fs-11;
    color: $faint;
  }

  /* 两个操作靠右挤在一起：gap 2 + 每个 6 的左右内边距 = 视觉 14，点击区域比字大 */
  &__ops {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-right: -6px;
  }

  &__op {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 6px;
  }

  &__op-count {
    font-size: $fs-11;
    color: $faint;

    &--on {
      color: $accent;
    }
  }
}

/* 收起状态下的展开入口：缩进到正文位置，不带灰底块，和 B 站「共 N 条回复」一个位置 */
.replies-more {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 6px 0 0 44px;
  padding: 2px 0;

  &__text {
    font-size: $fs-11;
    font-weight: 500;
    color: $accent;
  }
}

/* 楼层下的回复：缩进到正文位置（头像 34 + 间距 10），浅底一块，和楼层区分开 */
.replies {
  margin: 8px 0 0 44px;
  padding: 8px 10px;
  border-radius: $r-sm;
  background: $subtle;
  display: flex;
  flex-direction: column;
  gap: 8px;

  &__more {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-top: 2px;
  }

  &__more-text {
    font-size: $fs-11;
    font-weight: 500;
    color: $accent;
  }
}

/* 单条回复：头像 24，比楼层轻一档 */
.reply {
  display: flex;
  gap: 8px;

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
    gap: 6px;
    min-width: 0;
  }

  &__name {
    font-size: $fs-11;
    font-weight: 600;
    color: $ink;
    flex-shrink: 0;
  }

  /* 「回复 @某某」跟着名字后面，太长就省略 */
  &__to {
    flex: 1;
    min-width: 0;
    font-size: $fs-11;
    color: $accent-ink;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &__text {
    font-size: $fs-12;
    color: $ink;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 1px;
  }

  &__time {
    font-size: $fs-10;
    color: $faint;
  }

  &__ops {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-right: -6px;
  }

  /* 回复里的操作比楼层再小一档，别把浅底块撑高 */
  &__ops .comment__op {
    padding: 1px 6px;
  }
}

/* 输入栏：和截图 3 一样，常态是一条细长胶囊 + 右侧发送胶囊 */
.composer {
  display: flex;
  flex-direction: column;
  /* 下边距由 bottomInset() 内联控制 */
  padding: 10px 16px 0;
  background: $surface;
  border-top: 1px solid $line;
  flex-shrink: 0;

  &__row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  /* 输入框：整条胶囊，放大键贴在右内侧 */
  &__field {
    flex: 1;
    height: 40px;
    min-width: 0;
    padding: 0 4px 0 16px;
    border-radius: $r-full;
    background: $subtle;
    display: flex;
    align-items: center;
  }

  &__input {
    flex: 1;
    height: 40px;
    min-width: 0;
    padding-right: 4px;
    background: transparent;
    font-size: $fs-14;
    color: $ink;
  }

  &__ph {
    color: $faint;
  }

  /* 放大：空着时压暗，开始写字才点亮，不抢输入框的注意力 */
  &__expand {
    width: 32px;
    height: 32px;
    border-radius: $r-full;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.55;

    &--on {
      opacity: 1;
    }
  }

  /* 发送：和截图里的「发布」一样是圆角胶囊，空内容时压成灰底 */
  &__send {
    height: 38px;
    padding: 0 18px;
    border-radius: $r-full;
    background: $subtle;
    display: flex;
    align-items: center;
    justify-content: center;

    &--on {
      background: $accent;
    }

    &--busy {
      opacity: 0.55;
    }
  }

  &__send-text {
    font-size: $fs-13;
    font-weight: 600;
    color: $muted;

    &--on {
      color: $white;
    }
  }
}

/*
 * 放大后的编辑框：整屏白底（截图 2）。
 * 外层上下 padding 由内联控制：上面让开状态栏 + 胶囊，下面让开键盘或安全区；
 * 输入区高度由 editorInputHeight 按窗口尺寸算出来，工具条压在键盘上沿。
 */
.editor {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 300;
  box-sizing: border-box;
  background: $surface;
  display: flex;
  flex-direction: column;

  /* 工具行：高度内联成导航栏高度，右侧内联让开系统胶囊 */
  &__head {
    padding-left: $gutter;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  &__collapse {
    /* 图标 18，点击区域放大到 40，手指不用瞄准 */
    width: 40px;
    height: 40px;
    border-radius: $r-full;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* 高度由 editorInputHeight 内联控制，铺满整屏 */
  &__input {
    width: 100%;
    box-sizing: border-box;
    padding: 0 $gutter;
    background: transparent;
    font-size: $fs-16;
    line-height: 26px;
    color: $ink;
  }

  &__ph {
    color: $faint;
  }

  /* 工具条：高度必须和 JS 里的 EDITOR_FOOT_H（56 设计 px）保持一致 */
  &__foot {
    height: 56px;
    padding: 0 $gutter;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  &__count {
    font-size: $fs-11;
    color: $faint;

    &--max {
      color: $accent;
    }
  }

  /* 发送键落在工具条右侧，也就是键盘正上方 */
  &__send {
    height: 36px;
    padding: 0 20px;
    border-radius: $r-full;
    background: $subtle;
    display: flex;
    align-items: center;
    justify-content: center;

    &--on {
      background: $accent;
    }

    &--busy {
      opacity: 0.55;
    }
  }

  &__send-text {
    font-size: $fs-13;
    font-weight: 600;
    color: $muted;

    &--on {
      color: $white;
    }
  }
}

.closed-bar {
  /* 下边距由 bottomInset() 内联控制 */
  padding: 14px $gutter 0;
  background: $surface;
  border-top: 1px solid $line;
  display: flex;
  justify-content: center;
  flex-shrink: 0;

  &__text {
    font-size: $fs-11;
    color: $faint;
  }
}
</style>
