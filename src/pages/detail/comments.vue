<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
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

const shown = computed(() => {
  let list = [...comments.value]
  if (tab.value === 'hot') list = list.sort((a, b) => b.likeCount - a.likeCount)
  if (tab.value === 'latest') list = list.sort((a, b) => b.createdAt - a.createdAt)
  if (tab.value === 'mine') {
    const me = userStore.profile?.id
    list = list.filter((c) => c.isMine || (!!me && c.user.id === me))
  }
  return list
})

const pinned = computed(() => {
  const p = poll.value
  if (!p) return ''
  return p.type === 'survey'
    ? '问卷截止后会在这里关闭讨论，感谢大家的参与！'
    : '投票截止后会在这里公布最终结果，感谢大家的参与！'
})

async function load() {
  loading.value = true
  loadError.value = false
  try {
    poll.value = await fetchPoll(pollId.value)
    comments.value = await fetchComments(pollId.value)
  } catch {
    // 加载失败时 poll 是空的，不能让它掉进「发起人已关闭评论」的分支
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onLoad((q) => {
  pollId.value = (q?.id as string) ?? ''
})
onMounted(load)

async function send() {
  const text = draft.value.trim()
  if (!text || sending.value) return
  sending.value = true
  try {
    const created = await createComment(pollId.value, text, replyTo.value?.id)
    comments.value.unshift(created)
    if (poll.value) poll.value.commentCount = (poll.value.commentCount ?? 0) + 1
    draft.value = ''
    replyTo.value = null
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
}

function reply(c: Comment) {
  replyTo.value = { id: c.id, name: c.user.name }
  draft.value = ''
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
      await deleteComment(pollId.value, c.id)
      comments.value = comments.value.filter((x) => x.id !== c.id)
      if (poll.value) poll.value.commentCount = Math.max(0, (poll.value.commentCount ?? 0) - 1)
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

          <view v-for="c in shown" :key="c.id" class="comment" @longpress="onLongPress(c)">
            <AppAvatar :src="c.user.avatar" :name="c.user.name" :size="34" />
            <view class="comment__body">
              <view class="comment__top">
                <text class="comment__name">{{ c.user.name }}</text>
                <text class="comment__time">{{ formatRelative(c.createdAt) }}</text>
              </view>

              <text v-if="c.replyTo" class="comment__reply">回复 {{ c.replyTo.name }}：</text>
              <text class="comment__text">{{ c.content }}</text>

              <view class="comment__foot">
                <view class="comment__act" @tap="like(c)">
                  <AppIcon name="heart" :size="12" :color="c.liked ? '#4F46E5' : '#A1A1AA'" />
                  <text class="comment__act-text" :class="{ 'comment__act-text--on': c.liked }">
                    {{ c.likeCount ? `${c.likeCount} 赞` : '赞' }}
                  </text>
                </view>
                <view class="comment__act" @tap="reply(c)">
                  <AppIcon name="message-square" :size="12" color="#A1A1AA" />
                  <text class="comment__act-text">回复</text>
                </view>
              </view>
            </view>
          </view>

          <AppEmpty
            v-if="!shown.length"
            icon="message-square"
            :title="tab === 'mine' ? '你还没有发言' : '还没有人评论'"
            desc="说说你的想法，让发起人看到"
          />
        </view>
      </scroll-view>

      <!-- 输入栏 -->
      <view v-if="poll?.rules.allowComment" class="composer" :style="{ paddingBottom: bottomInset(20) }">
        <!-- 回复谁：提交时带 replyToId，清空或发送后消失 -->
        <view v-if="replyTo" class="composer__reply">
          <text class="composer__reply-text">回复 {{ replyTo.name }}</text>
          <view class="composer__reply-close" @tap="cancelReply">
            <AppIcon name="x" :size="10" color="#71717A" :stroke-width="2.5" />
          </view>
        </view>
        <view class="composer__row">
          <input
            v-model="draft"
            class="composer__input"
            :placeholder="replyTo ? `回复 ${replyTo.name}…` : '说点什么…'"
            placeholder-class="composer__ph"
            confirm-type="send"
            @confirm="send"
          />
          <view class="composer__send" :class="{ 'composer__send--on': draft.trim() }" @tap="send">
            <AppIcon name="send" :size="16" color="#FFFFFF" />
          </view>
        </view>
      </view>

      <view v-else class="closed-bar" :style="{ paddingBottom: bottomInset(14) }">
        <text class="closed-bar__text">发起人已关闭评论</text>
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

  /* 设计稿 26：Content gap 16、padding [4,20,16,20] */
  &__list {
    padding: 4px $gutter 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
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

/* 评论行：头像 34、行距 16，行与行之间一条通栏细线 */
.comment {
  display: flex;
  gap: 10px;

  & + & {
    border-top: 1px solid $line;
    padding-top: 16px;
  }

  &__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__name {
    font-size: 12px;
    font-weight: 600;
    color: $ink;
  }

  &__time {
    font-size: 10px;
    color: $faint;
  }

  &__reply {
    font-size: 11px;
    color: $accent-ink;
  }

  &__text {
    font-size: 13px;
    color: $ink;
    line-height: 1.55;
  }

  &__foot {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  &__act {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  &__act-text {
    font-size: 11px;
    color: $faint;

    &--on {
      color: $accent;
    }
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

  &__input {
    flex: 1;
    height: 42px;
    padding: 0 14px;
    border-radius: 12px;
    background: $subtle;
    font-size: 13px;
    color: $ink;
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
