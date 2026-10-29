<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app'
import type { Poll } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppAvatar from '@/components/base/AppAvatar.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import { fetchPoll, fetchVoters, fetchAnswers } from '@/api/poll'
import { formatRelative, formatMoment } from '@/utils/format'
import { bottomInset } from '@/utils/platform'

/**
 * 14/15 投票记录 + 73/74 回答记录
 *
 * 同一页，两个维度决定形态：
 *   poll.type === 'survey' → 行里显示回答正文（73/74），否则显示投给了哪一项（14/15）
 *   rules.anonymous       → 匿名只有流水号 + 时间，公开才有头像、昵称、搜索与排序
 *
 * 匿名不是「把名字打码」，而是真的没有名字，所以匿名态不显示头像位，
 * 也不给搜索框——搜不到的东西不要给入口。
 *
 * 布局按设计稿 14：Content 是一条竖向流（gap 14、padding [4,20,20,20]），
 * 依次是 上下文卡 → 匿名/公开说明条 → 搜索 → 分段 → 记录卡（整块一张卡，行间用分割线）。
 */
interface VoterRow {
  id: string
  createdAt: number
  user?: { id: string; name: string }
  /** 投票：投给了哪个选项 */
  optionTitle?: string
  /** 问卷：回答正文 */
  content?: string
  /** 发起人要求填的个人信息，只有发起人能拿到 */
  profileInfo?: string
}

const poll = ref<Poll | null>(null)
const voters = ref<VoterRow[]>([])
const loading = ref(true)
const keyword = ref('')
const sort = ref<'latest' | 'name'>('latest')
const pollId = ref('')
/** 分页：cursor 是上一页最后一条的时间戳，hasMore 由服务端给 */
const cursor = ref<string | null>(null)
const hasMore = ref(false)
const loadingMore = ref(false)

const isAnonymous = computed(() => poll.value?.rules.anonymous ?? true)
const isSurvey = computed(() => poll.value?.type === 'survey')
const isEnded = computed(() => !!poll.value && poll.value.rules.endAt <= Date.now())

const totalLabel = computed(() => (isSurvey.value ? '人已提交' : '人已投票'))

const shown = computed(() => {
  let list = voters.value
  if (!isAnonymous.value && keyword.value.trim()) {
    const k = keyword.value.trim()
    list = list.filter((v) => (v.user?.name ?? '').includes(k))
  }
  if (!isAnonymous.value && sort.value === 'name') {
    list = [...list].sort((a, b) => (a.user?.name ?? '').localeCompare(b.user?.name ?? '', 'zh'))
  }
  return list
})

/** 匿名列表的流水号：设计稿是从 #82 往上数，按时间倒序 */
const numbered = computed(() => shown.value.map((v, i) => ({ ...v, no: shown.value.length - i })))

/**
 * 取一页记录。reset 为 true 时从第一页重来，否则接着 cursor 往后翻。
 * 问卷走回答列表，投票走投票流水，两种数据在页面上落成同一个行结构。
 */
async function loadPage(reset: boolean) {
  const p = poll.value
  if (!p) return

  if (p.type === 'survey') {
    const res = await fetchAnswers(p.id, reset ? null : cursor.value)
    const rows: VoterRow[] = res.list.map((a) => ({
      id: a.id,
      createdAt: a.createdAt,
      user: a.user,
      content: a.content,
      profileInfo: a.profileInfo
    }))
    voters.value = reset ? rows : [...voters.value, ...rows]
    cursor.value = res.cursor
    hasMore.value = res.hasMore
  } else {
    const res = await fetchVoters(p.id, reset ? null : cursor.value)
    voters.value = reset ? res.list : [...voters.value, ...res.list]
    cursor.value = res.cursor
    hasMore.value = res.hasMore
  }
}

async function load() {
  loading.value = true
  try {
    poll.value = await fetchPoll(pollId.value)
    await loadPage(true)
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!hasMore.value || loadingMore.value) return
  loadingMore.value = true
  try {
    await loadPage(false)
  } catch {
    uni.showToast({ title: '加载失败，请重试', icon: 'none' })
  } finally {
    loadingMore.value = false
  }
}

onLoad((q) => {
  pollId.value = (q?.id as string) ?? ''
})
onMounted(load)

onPullDownRefresh(async () => {
  await load()
  uni.stopPullDownRefresh()
})
</script>

<template>
  <view class="voters">
    <AppNavBar :title="isSurvey ? '回答记录' : '投票记录'" />

    <view v-if="loading" class="voters__body">
      <AppSkeleton type="list" />
    </view>

    <template v-else-if="poll">
      <scroll-view class="voters__scroll" scroll-y>
        <view class="voters__content" :style="{ paddingBottom: bottomInset(20) }">
          <!-- 上下文卡：状态 + 匿名/公开标识 + 标题 + 大号人数 -->
          <view class="context">
            <view class="context__top">
              <view class="context__live" :class="{ 'context__live--ended': isEnded }">
                <view class="context__dot" :class="{ 'context__dot--ended': isEnded }" />
                <text class="context__live-text" :class="{ 'context__live-text--ended': isEnded }">
                  {{ isEnded ? '已结束' : '进行中' }}
                </text>
              </view>
              <view class="context__tag" :class="{ 'context__tag--public': !isAnonymous }">
                <AppIcon
                  :name="isAnonymous ? 'eye-off' : 'eye'"
                  :size="10"
                  :color="isAnonymous ? '#71717A' : '#4F46E5'"
                  :stroke-width="2"
                />
                <text class="context__tag-text" :class="{ 'context__tag-text--public': !isAnonymous }">
                  {{ isAnonymous ? (isSurvey ? '匿名收集' : '匿名投票') : isSurvey ? '公开收集' : '公开投票' }}
                </text>
              </view>
            </view>

            <text class="context__title">{{ poll.title }}</text>

            <view class="context__stat">
              <text class="context__num">{{ isSurvey ? poll.answerCount ?? 0 : poll.voterCount }}</text>
              <view class="context__note">
                <text class="context__note-main">{{ totalLabel }}</text>
                <text class="context__note-sub">
                  {{ isAnonymous ? '匿名不记录身份，只看时间' : '全部公开身份' }}
                </text>
              </view>
            </view>
          </view>

          <!-- 匿名说明条（14/73） -->
          <view v-if="isAnonymous" class="privacy">
            <AppIcon name="eye-off" :size="13" color="#A1A1AA" :stroke-width="2" />
            <text class="privacy__text">
              匿名{{ isSurvey ? '收集' : '投票' }}不会记录参与者身份。以下仅按时间展示每一条{{
                isSurvey ? '回答' : '投票'
              }}的提交记录，不关联到具体的人。
            </text>
          </view>

          <!-- 公开态：搜索 + 分段（15/74） -->
          <template v-else>
            <view class="search">
              <AppIcon name="search" :size="16" color="#A1A1AA" />
              <input
                v-model="keyword"
                class="search__input"
                placeholder="搜索姓名"
                placeholder-class="search__ph"
              />
            </view>

            <view class="segments">
              <view
                class="segments__item"
                :class="{ 'segments__item--on': sort === 'latest' }"
                @tap="sort = 'latest'"
              >
                <text class="segments__text" :class="{ 'segments__text--on': sort === 'latest' }">最新</text>
              </view>
              <view
                class="segments__item"
                :class="{ 'segments__item--on': sort === 'name' }"
                @tap="sort = 'name'"
              >
                <text class="segments__text" :class="{ 'segments__text--on': sort === 'name' }">按姓名</text>
              </view>
            </view>
          </template>

          <!-- 记录列表：整块一张卡，行与行之间一条分割线 -->
          <view v-if="shown.length" class="records" :class="{ 'records--survey': isSurvey }">
            <!-- 14 匿名投票：一条流水，只有序号、时间和「投了一票」 -->
            <template v-if="isAnonymous && !isSurvey">
              <view v-for="v in numbered" :key="v.id" class="rec">
                <view class="rec__index">
                  <text class="rec__index-text">#{{ v.no }}</text>
                </view>
                <view class="rec__info">
                  <text class="rec__name">匿名用户投了一票</text>
                  <text class="rec__time">{{ formatMoment(v.createdAt) }}</text>
                  <text v-if="v.profileInfo" class="rec__profile">{{ v.profileInfo }}</text>
                </view>
                <text class="rec__rel">{{ formatRelative(v.createdAt) }}</text>
              </view>
            </template>

            <!-- 73 匿名回答：序号 + 正文 -->
            <template v-else-if="isAnonymous">
              <view v-for="v in numbered" :key="v.id" class="rec rec--survey">
                <view class="rec__index">
                  <text class="rec__index-text">#{{ v.no }}</text>
                </view>
                <view class="rec__info">
                  <text class="rec__answer">{{ v.content }}</text>
                  <text class="rec__time">{{ formatRelative(v.createdAt) }}</text>
                  <text v-if="v.profileInfo" class="rec__profile">{{ v.profileInfo }}</text>
                </view>
              </view>
            </template>

            <!-- 15/74 公开：头像 + 昵称 + 时间 + 选择（右侧胶囊）或回答正文 -->
            <template v-else>
              <view v-for="v in shown" :key="v.id" class="rec rec--public" :class="{ 'rec--survey': isSurvey }">
                <AppAvatar :name="v.user?.name" :size="32" />
                <view class="rec__info">
                  <text class="rec__name">{{ v.user?.name }}</text>
                  <text class="rec__time">{{ formatRelative(v.createdAt) }}</text>
                  <text v-if="isSurvey" class="rec__answer">{{ v.content }}</text>
                  <text v-if="v.profileInfo" class="rec__profile">{{ v.profileInfo }}</text>
                </view>
                <view v-if="!isSurvey" class="rec__choice">
                  <text class="rec__choice-text">{{ v.optionTitle }}</text>
                </view>
              </view>
            </template>
          </view>

          <AppEmpty
            v-if="!shown.length"
            icon="inbox"
            :title="isSurvey ? '还没有回答记录' : '还没有投票记录'"
            :desc="isSurvey ? '有人提交后会出现在这里' : '有人投票后会出现在这里'"
          />

          <view
            v-if="shown.length && hasMore"
            class="voters__more"
            hover-class="voters__more--active"
            @tap="loadMore"
          >
            <text class="voters__more-text">{{ loadingMore ? '加载中…' : '加载更多记录' }}</text>
          </view>
        </view>
      </scroll-view>
    </template>
  </view>
</template>

<script lang="ts">
export default { name: 'PollVotersPage' }
</script>

<style lang="scss" scoped>
.voters {
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

  /* 设计稿 14：gap 14、padding [4,20,20,20]；下边距由 bottomInset(20) 内联控制 */
  &__content {
    padding: 4px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  &__more {
    padding: 10px 0;
    display: flex;
    justify-content: center;

    &--active {
      opacity: 0.6;
    }
  }

  &__more-text {
    font-size: 11px;
    color: $accent;
  }
}

/* 上下文卡 */
.context {
  padding: 14px;
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__live {
    padding: 3px 8px;
    border-radius: 6px;
    background: $success-soft;
    display: flex;
    align-items: center;
    gap: 5px;

    &--ended {
      background: $subtle;
    }
  }

  &__dot {
    width: 5px;
    height: 5px;
    border-radius: 3px;
    background: $success;

    &--ended {
      background: $faint;
    }
  }

  &__live-text {
    font-size: 10px;
    font-weight: 600;
    color: $success;

    &--ended {
      color: $faint;
    }
  }

  &__tag {
    padding: 3px 8px;
    border-radius: 6px;
    background: $subtle;
    display: flex;
    align-items: center;
    gap: 4px;

    &--public {
      background: $accent-soft;
    }
  }

  &__tag-text {
    font-size: 10px;
    font-weight: 600;
    color: $muted;

    &--public {
      color: $accent;
    }
  }

  &__title {
    font-size: 15px;
    font-weight: 600;
    color: $ink;
    line-height: 1.4;
  }

  &__stat {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__num {
    font-size: 32px;
    font-weight: 700;
    color: $accent;
    font-family: $font-num;
    line-height: 1;
  }

  &__note {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  &__note-main {
    font-size: 11px;
    font-weight: 600;
    color: $ink;
  }

  &__note-sub {
    font-size: 9px;
    color: $faint;
  }
}

/* 匿名说明条 */
.privacy {
  padding: 11px 12px;
  border-radius: 10px;
  background: $subtle;
  display: flex;
  align-items: flex-start;
  gap: 8px;

  &__text {
    flex: 1;
    font-size: 10px;
    color: $muted;
    line-height: 1.55;
  }
}

/* 搜索（15） */
.search {
  height: 42px;
  padding: 0 14px;
  border-radius: 12px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  gap: 9px;

  &__input {
    flex: 1;
    font-size: 13px;
    color: $ink;
  }

  &__ph {
    color: $faint;
    font-size: 13px;
  }
}

/* 分段控件 */
.segments {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: $subtle;

  &__item {
    flex: 1;
    padding: 8px 0;
    border-radius: 9px;
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

/* 记录卡：14/15 是 r14 行内边距 [13,14]；73/74 是 r16、卡片左右 16、行内不再留白 */
.records {
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;
  overflow: hidden;

  &--survey {
    border-radius: 16px;
    padding: 0 16px;
  }
}

.rec {
  position: relative;
  padding: 13px 14px;
  display: flex;
  align-items: center;
  gap: 12px;

  /* 分割线单独画，问卷态要让它从文字左沿开始 */
  & + &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: $line;
  }

  /* 序号块：14 是 30×30 圆角 9；73 是 32×32 圆角 10 */
  &__index {
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: $subtle;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__index-text {
    font-size: 11px;
    font-weight: 600;
    color: $muted;
    font-family: $font-num;
  }

  &__info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__name {
    font-size: 12px;
    font-weight: 500;
    color: $ink;
  }

  &__answer {
    font-size: 13px;
    color: $ink;
    line-height: 1.5;
  }

  &__time {
    font-size: 10px;
    color: $faint;
  }

  /* 「需个人信息」：发起人要求填的那一项，只有发起人看得到 */
  &__profile {
    font-size: 10px;
    color: $muted;
    padding: 3px 6px;
    align-self: flex-start;
    border-radius: 5px;
    background: $subtle;
  }

  &__rel {
    font-size: 10px;
    color: $faint;
    flex-shrink: 0;
  }

  /* 公开态：头像 32、间距 11 */
  &--public {
    gap: 11px;
    padding: 12px 14px;
  }

  &--public &__name {
    font-size: 12px;
    font-weight: 600;
  }

  &--survey {
    align-items: flex-start;
    padding: 12px 0;
    gap: 10px;
  }

  &--survey + &--survey::before {
    left: 42px;
  }

  &--survey &__index {
    width: 32px;
    height: 32px;
    border-radius: 10px;
  }

  &--survey &__index-text {
    font-weight: 700;
  }

  &--survey &__time {
    font-size: 11px;
  }

  &--survey &__answer {
    font-size: 12px;
    line-height: 1.5;
  }

  /* 选中的选项：$accent-soft 胶囊 */
  &__choice {
    padding: 5px 10px;
    border-radius: 6px;
    background: $accent-soft;
    flex-shrink: 0;
    max-width: 45%;
  }

  &__choice-text {
    font-size: 10px;
    font-weight: 600;
    color: $accent;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    display: block;
  }
}
</style>
