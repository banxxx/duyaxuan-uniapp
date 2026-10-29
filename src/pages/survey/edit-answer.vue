<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { Poll, SurveyAnswer } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import { fetchPoll, fetchMyAnswers, updateAnswer } from '@/api/poll'
import { formatCreatedAt, formatRelative, formatRemaining, charCount } from '@/utils/format'
import { bottomInset } from '@/utils/platform'
import { back } from '@/utils/router'

/**
 * 72 问卷 · 编辑回答
 *
 * 和 64 待填写是同一个表单，区别在于：
 *   - 输入框预填原回答
 *   - 标题提示「自由填写 · 编辑中」
 *   - 底部说明写「这是第 N 次提交的内容，保存后原回答将被替换」
 *   - 按钮是「保存修改」不是「提交回答」
 *
 * 「第 N 次」要算准：从 71 列表进来时传了 answerId，
 * 这里按时间正序重新数一遍，不信任调用方传序号。
 */
const poll = ref<Poll | null>(null)
const answers = ref<SurveyAnswer[]>([])
const answerId = ref('')
const pollId = ref('')

const loading = ref(true)
const saving = ref(false)
const content = ref('')

const MAX = 500
const count = computed(() => charCount(content.value))

const order = computed(() => {
  const sorted = [...answers.value].sort((a, b) => a.createdAt - b.createdAt)
  return sorted.findIndex((a) => a.id === answerId.value) + 1
})

const origin = computed(() => answers.value.find((a) => a.id === answerId.value))

const isEnded = computed(() => !!poll.value && poll.value.rules.endAt <= Date.now())

async function load() {
  loading.value = true
  try {
    const [p, list] = await Promise.all([fetchPoll(pollId.value), fetchMyAnswers(pollId.value)])
    poll.value = p
    answers.value = list

    // 没传 answerId 时默认改最近一条
    if (!answerId.value && list.length) {
      const latest = [...list].sort((a, b) => b.createdAt - a.createdAt)[0]
      answerId.value = latest.id
    }
    const hit = list.find((a) => a.id === answerId.value)
    content.value = hit?.content ?? ''
  } finally {
    loading.value = false
  }
}

onLoad((q) => {
  pollId.value = (q?.id as string) ?? ''
  answerId.value = (q?.answerId as string) ?? ''
})
onMounted(load)

async function save() {
  if (!poll.value || !answerId.value) return
  saving.value = true
  try {
    await updateAnswer(poll.value.id, answerId.value, content.value.trim())
    uni.showToast({ title: '已保存', icon: 'none' })
    setTimeout(back, 600)
  } catch {
    uni.showToast({ title: '保存失败，请重试', icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="edit-answer">
    <AppNavBar :back="true" />

    <view v-if="loading" class="edit-answer__body">
      <AppSkeleton type="detail" />
    </view>

    <template v-else-if="poll">
      <scroll-view class="edit-answer__scroll" scroll-y>
        <view class="edit-answer__content">
          <view class="meta">
            <view class="meta__live" :class="{ 'meta__live--ended': isEnded }">
              <view class="meta__dot" :class="{ 'meta__dot--ended': isEnded }" />
              <text class="meta__live-text" :class="{ 'meta__live-text--ended': isEnded }">
                {{ isEnded ? '已截止' : `进行中 · ${formatRemaining(poll.rules.endAt)}` }}
              </text>
            </view>
            <view class="meta__chip"><text class="meta__chip-text">问卷</text></view>
            <view class="meta__chip">
              <text class="meta__chip-text">{{ poll.rules.anonymous ? '匿名' : '公开' }}</text>
            </view>
            <view v-if="poll.rules.profileField" class="meta__chip meta__chip--warn">
              <text class="meta__chip-text meta__chip-text--warn">需填信息</text>
            </view>
          </view>

          <text class="edit-answer__title">{{ poll.title }}</text>
          <text v-if="poll.desc" class="edit-answer__desc">{{ poll.desc }}</text>

          <view class="author">
            <view class="author__avatar">
              <text class="author__initial">{{ poll.creatorName.slice(0, 1) }}</text>
            </view>
            <view class="author__info">
              <text class="author__name">{{ poll.creatorName }} · 发起人</text>
              <text class="author__time">
                {{ formatCreatedAt(poll.createdAt, `创建 · ${poll.rules.anonymous ? '匿名' : '公开'}收集`) }}
              </text>
            </view>
          </view>

          <view class="edit-answer__divider" />

          <view class="question">
            <text class="question__label">说说你的想法</text>
            <text class="question__hint">自由填写 · 编辑中</text>
          </view>

          <view class="area">
            <view class="area__box">
              <textarea
                v-model="content"
                class="area__input"
                :maxlength="MAX"
                placeholder="想去哪里、想玩什么、预算大概多少，随便聊聊～"
                placeholder-class="area__ph"
                :disabled="isEnded"
              />
            </view>
            <view class="area__foot">
              <text class="area__tip">修改会覆盖这条提交，字数上限 {{ MAX }}</text>
              <text class="area__count">{{ count }}/{{ MAX }}</text>
            </view>
          </view>

          <text class="edit-answer__note">
            这是第 {{ order }} 次提交的内容{{ origin ? `（${formatRelative(origin.createdAt)}提交）` : '' }}，保存后原回答将被替换。
          </text>
        </view>
      </scroll-view>

      <view class="edit-answer__actions" :style="{ paddingBottom: bottomInset(20) }">
        <AppButton :disabled="isEnded" :loading="saving" @tap="save">
          {{ isEnded ? '问卷已截止' : '保存修改' }}
        </AppButton>
      </view>
    </template>
  </view>
</template>

<script lang="ts">
export default { name: 'SurveyEditAnswerPage' }
</script>

<style lang="scss" scoped>
.edit-answer {
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
    padding: 8px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  &__title {
    font-size: 26px;
    font-weight: 700;
    color: $ink;
    line-height: 1.32;
  }

  &__desc {
    font-size: 13px;
    color: $muted;
    line-height: 1.55;
  }

  &__divider {
    height: 1px;
    background: $line;
  }

  &__note {
    font-size: 11px;
    color: $faint;
    line-height: 1.55;
  }

  &__actions {
    /* 下边距由 bottomInset() 内联控制 */
    padding: 12px $gutter 0;
    flex-shrink: 0;
  }
}

.meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;

  &__live {
    padding: 5px 10px;
    border-radius: 8px;
    background: $success-soft;
    display: flex;
    align-items: center;
    gap: 6px;

    &--ended {
      background: $subtle;
    }
  }

  &__dot {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: $success;

    &--ended {
      background: $faint;
    }
  }

  &__live-text {
    font-size: 11px;
    font-weight: 600;
    color: $success;

    &--ended {
      color: $faint;
    }
  }

  &__chip {
    padding: 5px 8px;
    border-radius: 6px;
    background: $subtle;
    display: flex;
    align-items: center;

    &--warn {
      background: $warning-soft;
    }
  }

  &__chip-text {
    font-size: 11px;
    color: $muted;

    &--warn {
      color: $warning;
      font-weight: 600;
    }
  }
}

.author {
  display: flex;
  align-items: center;
  gap: 10px;

  &__avatar {
    width: 34px;
    height: 34px;
    border-radius: 17px;
    background: $accent-soft;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__initial {
    font-size: 13px;
    font-weight: 700;
    color: $accent-ink;
  }

  &__info {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  &__name {
    font-size: 12px;
    font-weight: 600;
    color: $ink;
  }

  &__time {
    font-size: 11px;
    color: $faint;
  }
}

.question {
  display: flex;
  align-items: baseline;
  justify-content: space-between;

  &__label {
    font-size: 13px;
    font-weight: 600;
    color: $ink;
  }

  &__hint {
    font-size: 12px;
    color: $faint;
  }
}

.area {
  padding: 14px;
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__box {
    height: 148px;
    padding: 12px;
    border-radius: 10px;
    background: $bg;
  }

  &__input {
    width: 100%;
    height: 100%;
    font-size: 13px;
    color: $ink;
    line-height: 1.6;
  }

  &__ph {
    color: $faint;
  }

  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__tip,
  &__count {
    font-size: 11px;
    color: $faint;
  }
}
</style>
