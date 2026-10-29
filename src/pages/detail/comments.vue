<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { Poll, Comment } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppAvatar from '@/components/base/AppAvatar.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import {
  fetchPoll,
  fetchComments,
  createComment,
  deleteComment,
  setCommentLike
} from '@/api/poll'
import { useUserStore } from '@/stores/user'
import { formatRelative } from '@/utils/format'
import { bottomInset } from '@/utils/platform'
import { cacheGet, cacheSet, cacheKey } from '@/utils/cache'

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
const tab = ref<'latest' | 'hot' | 'mine'>('latest')
const draft = ref('')
const sending = ref(false)
const pollId = ref('')
/** 回复谁：界面上的「回复 xx」提示条 + 提交时带 replyToId */
const replyTo = ref<{ id: string; name: string } | null>(null)

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

/** 编辑框按内容长高：3 行起步，最多 8 行，再长就在框里滚 */
const EDITOR_MIN_ROWS = 3
const EDITOR_MAX_ROWS = 8
const EDITOR_LINE_HEIGHT = 22
/** 上下内边距，高度是 border-box，要一起算进去 */
const EDITOR_PAD_Y = 24
/** 一行大约放多少个字（15px 字号、350 宽的面板）—— 只用来估高度，不要求精确 */
const EDITOR_COLS = 20

const editorHeight = computed(() => {
  let lines = 0
  for (const line of draft.value.split('\n')) {
    lines += Math.max(1, Math.ceil(line.length / EDITOR_COLS))
  }
  const rows = Math.min(EDITOR_MAX_ROWS, Math.max(EDITOR_MIN_ROWS, lines))
  return `${rows * EDITOR_LINE_HEIGHT + EDITOR_PAD_Y}px`
})

/** 输入栏底部留白：键盘弹起时让开键盘，收起时退回安全区 */
const composerInset = computed(() =>
  keyboardHeight.value > 0 ? `${keyboardHeight.value}px` : bottomInset(20)
)

function onKeyboard(res: { height: number }) {
  keyboardHeight.value = res.height
}

/** 放大：开全屏编辑框，焦点交给里面的 textarea */
function openEditor() {
  editorOpen.value = true
  nextTick(() => {
    // 微信里紧接着聚焦偶尔弹不出键盘，隔一帧再点一次
    setTimeout(() => {
      editorFocus.value = true
    }, 60)
  })
}

function closeEditor() {
  editorFocus.value = false
  editorOpen.value = false
  try {
    uni.hideKeyboard()
  } catch {
    /* 非小程序端没有这个 API */
  }
}

/** 全屏编辑框里发送：成功才关掉，失败留在原地继续改 */
async function sendFromEditor() {
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
  // 最新：接口本来就是 created_at DESC，保持原顺序
  if (tab.value === 'hot') list = [...list].sort((a, b) => b.likeCount - a.likeCount)
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
    comments.value = await fetchComments(pollId.value)
    saveSnapshot()
  } catch {
    // 加载失败时 poll 是空的，不能让它掉进「发起人已关闭评论」的分支
    if (!poll.value) loadError.value = true
  } finally {
    loading.value = false
  }
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
  // 只换回复目标，已经打了一半的字不能跟着清掉
  replyTo.value = { id: c.id, name: c.user.name }
}

function cancelReply() {
  replyTo.value = null
}

/** 长按删除：作者本人或发起人 */
function onLongPress(c: Comment) {
  const me = userStore.profile?.id
  const canDelete = c.isMine || (!!me && poll.value?.creatorId === me)
  if (!canDelete) return
  uni.showActionSheet({
    itemList: ['删除评论'],
    success: async (res) => {
      if (res.tapIndex !== 0) return
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
  })
}
</script>

<template>
  <view class="comments">
    <AppNavBar title="讨论区" />

    <view v-if="loading" class="comments__body">
      <AppSkeleton type="list" />
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
      <scroll-view class="comments__scroll" scroll-y>
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
              @tap="tab = t.key as any"
            >
              <text class="tabs__text" :class="{ 'tabs__text--on': tab === t.key }">{{ t.label }}</text>
            </view>
          </view>

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
                <text class="comment__text">{{ t.root.content }}</text>

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

                  <text class="reply__text">{{ r.content }}</text>

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
        </view>
      </scroll-view>

      <!-- 输入栏：键盘弹起时整条抬起来，靠 composerInset 让出键盘高度 -->
      <view v-if="poll?.rules.allowComment" class="composer" :style="{ paddingBottom: composerInset }">
        <!-- 回复谁：提交时带 replyToId，清空或发送后消失 -->
        <view v-if="replyTo" class="composer__reply">
          <text class="composer__reply-text">回复 {{ replyTo.name }}</text>
          <view class="composer__reply-close" @tap="cancelReply">
            <AppIcon name="x" :size="10" color="#71717A" :stroke-width="2.5" />
          </view>
        </view>
        <view class="composer__row">
          <view class="composer__field">
            <input
              v-model="draft"
              class="composer__input"
              :placeholder="replyTo ? `回复 ${replyTo.name}…` : '说点什么…'"
              placeholder-class="composer__ph"
              confirm-type="send"
              maxlength="500"
              :adjust-position="false"
              :cursor-spacing="0"
              @confirm="send"
            />
            <!-- 放大：没写字时压暗，写了字点亮；点开全屏编辑框 -->
            <view
              class="composer__expand"
              :class="{ 'composer__expand--on': draft.trim() }"
              @tap="openEditor"
            >
              <AppIcon name="maximize-2" :size="14" :color="draft.trim() ? '#4F46E5' : '#A1A1AA'" />
            </view>
          </view>
          <!-- 发送中按钮压暗，挡住重复点击；失败后草稿还在，可以直接重发 -->
          <view
            class="composer__send"
            :class="{ 'composer__send--on': draft.trim(), 'composer__send--busy': sending }"
            @tap="send"
          >
            <AppIcon name="send" :size="16" color="#FFFFFF" />
          </view>
        </view>
      </view>

      <view v-else class="closed-bar" :style="{ paddingBottom: bottomInset(14) }">
        <text class="closed-bar__text">发起人已关闭评论</text>
      </view>

      <!--
        放大后的编辑框：贴底的一块面板，底边永远压在键盘上沿。
        输入越多，面板靠 textarea 长高往上顶，而不是把内容往屏幕外挤。
      -->
      <view
        v-if="editorOpen"
        class="editor"
        :style="{ paddingBottom: keyboardHeight ? keyboardHeight + 'px' : bottomInset(0) }"
      >
        <view class="editor__mask" @tap="closeEditor" @touchmove.stop.prevent />

        <view class="editor__panel">
          <view class="editor__head">
            <text class="editor__target">{{ replyTo ? `回复 ${replyTo.name}` : '写评论' }}</text>
            <view class="editor__close" @tap="closeEditor">
              <AppIcon name="x" :size="16" color="#71717A" :stroke-width="2" />
            </view>
          </view>

          <textarea
            v-model="draft"
            class="editor__input"
            :style="{ height: editorHeight }"
            :focus="editorFocus"
            :maxlength="500"
            :adjust-position="false"
            :show-confirm-bar="false"
            :disable-default-padding="true"
            :cursor-spacing="16"
            :placeholder="replyTo ? `回复 ${replyTo.name}…` : '说点什么…'"
            placeholder-class="editor__ph"
          />

          <view class="editor__foot">
            <text class="editor__count" :class="{ 'editor__count--max': draft.length >= 500 }">
              {{ draft.length }}/500
            </text>
            <view
              class="editor__send"
              :class="{ 'editor__send--on': draft.trim(), 'editor__send--busy': sending }"
              @tap="sendFromEditor"
            >
              <text class="editor__send-text">发送</text>
            </view>
          </view>
        </view>
      </view>
    </template>
  </view>
</template>

<script lang="ts">
export default { name: 'PollCommentsPage' }
</script>

<style lang="scss" scoped>
.comments {
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

  /* 设计稿 26：Content gap 12、padding [4,20,16,20]。
     楼层之间是 gap 12 + 分隔线 + padding-top 12，比原来紧一档 */
  &__list {
    padding: 4px $gutter 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
}

/* 分段：设计稿 26 与 15/44 同一套 */
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

/* 发起人置顶：$accent-soft、圆角 12、内边距 14 */
.pinned {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  background: $accent-soft;
  border-radius: 12px;

  &__head {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  &__name {
    font-size: 11px;
    font-weight: 600;
    color: $accent;
  }

  &__text {
    font-size: 12px;
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
    font-size: 12px;
    font-weight: 600;
    color: $ink;
    line-height: 1.4;
  }

  &__reply {
    font-size: 11px;
    color: $accent-ink;
  }

  &__text {
    font-size: 13px;
    color: $ink;
    line-height: 1.5;
  }

  /* 时间在左、操作在右：头部只剩名字，视觉上少一层 */
  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 1px;
  }

  &__time {
    font-size: 11px;
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
    font-size: 11px;
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
    font-size: 11px;
    font-weight: 500;
    color: $accent;
  }
}

/* 楼层下的回复：缩进到正文位置（头像 34 + 间距 10），浅底一块，和楼层区分开 */
.replies {
  margin: 8px 0 0 44px;
  padding: 8px 10px;
  border-radius: 10px;
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
    font-size: 11px;
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
    font-size: 11px;
    font-weight: 600;
    color: $ink;
    flex-shrink: 0;
  }

  /* 「回复 @某某」跟着名字后面，太长就省略 */
  &__to {
    flex: 1;
    min-width: 0;
    font-size: 11px;
    color: $accent-ink;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &__text {
    font-size: 12px;
    color: $ink;
    line-height: 1.5;
  }

  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 1px;
  }

  &__time {
    font-size: 10px;
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

/* 输入栏：设计稿 26 —— 42 高的 $subtle 输入框 + 42 的方形发送按钮，间距 10 */
.composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
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

  /* 回复提示：贴在输入框上方，高度固定，去掉时输入栏不跳 */
  &__reply {
    height: 22px;
    padding: 0 8px 0 10px;
    border-radius: 8px;
    background: $subtle;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__reply-text {
    font-size: 11px;
    color: $muted;
  }

  &__reply-close {
    padding: 2px 0 2px 8px;
  }

  /* 输入框 + 放大按钮合成一个胶囊，放大键贴在右内侧（B 站的位置） */
  &__field {
    flex: 1;
    height: 42px;
    min-width: 0;
    padding-right: 4px;
    border-radius: 12px;
    background: $subtle;
    display: flex;
    align-items: center;
  }

  &__input {
    flex: 1;
    height: 42px;
    min-width: 0;
    padding: 0 8px 0 14px;
    background: transparent;
    font-size: 13px;
    color: $ink;
  }

  /* 放大：空着时压暗，开始写字才点亮，不抢输入框的注意力 */
  &__expand {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.55;

    &--on {
      opacity: 1;
    }
  }

  &__ph {
    color: $faint;
  }

  &__send {
    width: 42px;
    height: 42px;
    border-radius: 12px;
    background: $line;
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
}

/*
 * 放大后的编辑框：贴底的一块面板。
 * 外层 padding-bottom 内联成键盘高度，所以面板底边永远压在键盘上沿；
 * 输入变多时 textarea 长高，面板往上顶，发送键始终贴着键盘。
 */
.editor {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 300;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;

  &__mask {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    background: rgba(9, 9, 11, 0.32);
  }

  &__panel {
    position: relative;
    padding: 14px $gutter 12px;
    border-radius: 16px 16px 0 0;
    background: $surface;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__target {
    font-size: 12px;
    font-weight: 500;
    color: $muted;
  }

  &__close {
    width: 24px;
    height: 24px;
    margin-right: -4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* 高度由 editorHeight 内联控制（3~8 行），再长就在框里滚 */
  &__input {
    width: 100%;
    padding: 12px 14px;
    border-radius: 12px;
    background: $subtle;
    font-size: 15px;
    line-height: 22px;
    color: $ink;
  }

  &__ph {
    color: $faint;
  }

  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__count {
    font-size: 11px;
    color: $faint;

    &--max {
      color: $accent;
    }
  }

  /* 发送键落在面板右下角，也就是键盘正上方 */
  &__send {
    height: 34px;
    padding: 0 18px;
    border-radius: 10px;
    background: $line;
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
    font-size: 13px;
    font-weight: 600;
    color: #ffffff;
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
    font-size: 11px;
    color: $faint;
  }
}
</style>
