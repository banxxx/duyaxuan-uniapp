<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app'
import type { Poll, SurveyAnswer } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import { fetchPoll, fetchMyAnswers } from '@/api/poll'
import { formatRelative, charCount } from '@/utils/format'
import { bottomInset } from '@/utils/platform'
import { ROUTES, go } from '@/utils/router'
import AppToast from '@/components/base/AppToast.vue'
import { toast } from '@/utils/toast'

/**
 * 71 我的提交记录
 *
 * 只有「允许重复提交」的问卷才会进到这一页——不允许重复时，
 * 详情页底部是「修改我的回答」而不是「我的提交」，没有列表可看。
 *
 * 排序：时间倒序，第一条标「最新」。每条都能点「修改」进 72，
 * 因为重复提交场景下「改哪一次」必须由用户指认，不能默认改最新那条。
 */
const poll = ref<Poll | null>(null)
const answers = ref<SurveyAnswer[]>([])
const loading = ref(true)
/** 首屏加载失败：给错误页和重试，不要停在空白页 */
const loadError = ref(false)
const pollId = ref('')

const isEnded = computed(() => !!poll.value && poll.value.rules.endAt <= Date.now())

async function load() {
  loading.value = true
  loadError.value = false
  try {
    const [p, list] = await Promise.all([fetchPoll(pollId.value), fetchMyAnswers(pollId.value)])
    poll.value = p
    answers.value = [...list].sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
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

/** 第几次：按时间正序算序号，展示时仍按倒序 */
function orderOf(a: SurveyAnswer) {
  const sorted = [...answers.value].sort((x, y) => x.createdAt - y.createdAt)
  return sorted.findIndex((x) => x.id === a.id) + 1
}

function edit(a: SurveyAnswer) {
  if (isEnded.value) {
    toast.show('问卷已截止，不能再修改')
    return
  }
  go(ROUTES.surveyEditAnswer, { id: pollId.value, answerId: a.id })
}

function fillAgain() {
  go(ROUTES.surveyFill, { id: pollId.value })
}
</script>

<template>
  <view class="mine">
    <AppToast />
    <AppNavBar title="我的提交" />

    <view v-if="loading" class="mine__body">
      <AppSkeleton type="list" />
    </view>

    <AppEmpty
      v-else-if="loadError"
      icon="wifi-off"
      title="加载失败"
      desc="网络不太稳定，或者这份问卷已经被删除"
      action="重新加载"
      action-icon="refresh-cw"
      @action="load"
    />

    <scroll-view v-else-if="poll" class="mine__scroll" scroll-y>
      <view class="mine__content" :style="{ paddingBottom: bottomInset(20) }">
        <!-- 问卷上下文 -->
        <view class="context">
          <view class="context__top">
            <view class="context__live" :class="{ 'context__live--ended': isEnded }">
              <view class="context__dot" :class="{ 'context__dot--ended': isEnded }" />
              <text class="context__live-text" :class="{ 'context__live-text--ended': isEnded }">
                {{ isEnded ? '已截止' : '进行中' }}
              </text>
            </view>
            <view class="context__tag">
              <AppIcon name="eye-off" :size="10" color="#71717A" />
              <text class="context__tag-text">{{ poll.rules.anonymous ? '匿名收集' : '公开收集' }}</text>
            </view>
          </view>

          <text class="context__title">{{ poll.title }}</text>

          <view class="context__stat">
            <text class="context__num">{{ answers.length }}</text>
            <view class="context__note">
              <text class="context__note-title">次提交</text>
              <text class="context__note-desc">允许重复提交，可随时补充新的想法</text>
            </view>
          </view>
        </view>

        <!-- 隐私说明：$subtle r10 pad[11,12] -->
        <view class="privacy">
          <AppIcon name="eye-off" :size="13" color="#A1A1AA" />
          <text class="privacy__text">
            你在这份问卷里提交过 {{ answers.length }} 次回答，按时间倒序展示。每次提交独立计入总数。
          </text>
        </view>

        <!-- 提交列表：r14 pad[14,16] gap10 -->
        <view class="timeline">
          <view v-for="(a, i) in answers" :key="a.id" class="item">
            <view class="item__head">
              <view class="item__left">
                <view class="item__idx">
                  <text class="item__idx-text">第 {{ orderOf(a) }} 次</text>
                </view>
                <text class="item__time">{{ formatRelative(a.createdAt) }}</text>
              </view>
              <view class="item__right">
                <view v-if="i === 0" class="item__latest">
                  <text class="item__latest-text">最新</text>
                </view>
                <view class="item__edit" @tap="edit(a)">
                  <AppIcon name="square-pen" :size="13" color="#4F46E5" />
                  <text class="item__edit-text">修改</text>
                </view>
              </view>
            </view>

            <text class="item__answer">{{ a.content || '（跳过未答）' }}</text>
            <text class="item__count">{{ charCount(a.content) }} 字</text>
          </view>

          <AppEmpty
            v-if="!answers.length"
            icon="inbox"
            title="还没有提交记录"
            desc="提交一次回答后会出现在这里"
          />
        </view>

        <view v-if="answers.length" class="more" @tap="fillAgain">
          <text class="more__text">再提交一次</text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script lang="ts">
export default { name: 'SurveyMinePage' }
</script>

<style lang="scss" scoped>
.mine {
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
    /* 下边距由 bottomInset(20) 内联控制 */
    padding: 4px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
}

.context {
  padding: 14px;
  border-radius: $r-input;
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
    border-radius: $r-xs;
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
    font-size: $fs-10;
    font-weight: 600;
    color: $success;

    &--ended {
      color: $faint;
    }
  }

  &__tag {
    padding: 3px 8px;
    border-radius: $r-xs;
    background: $subtle;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  &__tag-text {
    font-size: $fs-10;
    font-weight: 600;
    color: $muted;
  }

  &__title {
    font-size: $fs-15;
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
    font-size: $fs-32;
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

  &__note-title {
    font-size: $fs-11;
    font-weight: 600;
    color: $ink;
  }

  &__note-desc {
    font-size: $fs-10;
    color: $faint;
  }
}

.privacy {
  padding: 11px 12px;
  border-radius: $r-sm;
  background: $subtle;
  display: flex;
  gap: 8px;
  align-items: flex-start;

  &__text {
    flex: 1;
    font-size: $fs-10;
    color: $muted;
    line-height: 1.55;
  }
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.item {
  padding: 14px 16px;
  border-radius: $r-input;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__idx {
    padding: 2px 7px;
    border-radius: $r-xs;
    background: $subtle;
    display: flex;
    align-items: center;
  }

  &__idx-text {
    font-size: $fs-10;
    font-weight: 700;
    color: $muted;
  }

  &__time {
    font-size: $fs-11;
    color: $faint;
  }

  &__right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__latest {
    padding: 2px 7px;
    border-radius: $r-xs;
    background: $accent-soft;
    display: flex;
    align-items: center;
  }

  &__latest-text {
    font-size: $fs-10;
    font-weight: 600;
    color: $accent;
  }

  &__edit {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  &__edit-text {
    font-size: $fs-11;
    font-weight: 600;
    color: $accent;
  }

  &__answer {
    font-size: $fs-13;
    color: $ink;
    line-height: 1.55;
  }

  &__count {
    font-size: $fs-10;
    color: $faint;
  }
}

.more {
  padding: 8px 0;
  display: flex;
  justify-content: center;

  &__text {
    font-size: $fs-11;
    color: $accent;
  }
}
</style>
