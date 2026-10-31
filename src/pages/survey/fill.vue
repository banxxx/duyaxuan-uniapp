<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onLoad, onShareAppMessage } from '@dcloudio/uni-app'
import type { Poll } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSheet from '@/components/base/AppSheet.vue'
import AppInviteCode from '@/components/base/AppInviteCode.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import { fetchPoll, submitAnswer, joinPoll } from '@/api/poll'
import { formatCreatedAt, formatRemaining, charCount } from '@/utils/format'
import { buildShareMessage } from '@/utils/share'
import { useInviteCode } from '@/utils/invite'
import { bottomInset } from '@/utils/platform'
import { ROUTES, replace } from '@/utils/router'
import AppToast from '@/components/base/AppToast.vue'
import { toast } from '@/utils/toast'

/**
 * 64 问卷 · 待填写（含 65 填写信息弹窗）
 *
 * 和投票详情页的区别只有一处：单选/多选列表换成 148 高的多行输入框。
 * 上限 500 字，可跳过（空提交也算一份），提交后按规则决定能不能改。
 *
 * 「提交后可在截止前修改这条回答」这句提示只在 allowEdit 时出现——
 * 规则没开却提示能改，是设计稿里最容易埋的坑，这里按实际规则渲染。
 */
const poll = ref<Poll | null>(null)
/** 邀请码模式的问卷：被 403 拦下时弹自定义输入层 */
const invite = useInviteCode()
const loading = ref(true)
/** 首屏加载失败：给错误页和重试，不要停在空白页 */
const loadError = ref(false)
const submitting = ref(false)
const content = ref('')
const pollId = ref('')

/** 65 需填信息 */
const infoVisible = ref(false)
const infoValue = ref('')

const MAX = 500

const isEnded = computed(() => !!poll.value && poll.value.rules.endAt <= Date.now())
const canEditAfter = computed(() => !!poll.value?.rules.allowEdit)
const count = computed(() => charCount(content.value))

async function load() {
  loading.value = true
  loadError.value = false
  try {
    poll.value = await fetchPoll(pollId.value)
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

function onSubmit() {
  if (!poll.value || isEnded.value) return
  if (poll.value.rules.profileField) {
    infoVisible.value = true
    return
  }
  doSubmit()
}

async function doSubmit() {
  const p = poll.value
  if (!p) return
  submitting.value = true
  try {
    // 邀请码模式的问卷：被 403 拦下时收一次码，加入后重试一次
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await submitAnswer(
          p.id,
          content.value.trim(),
          infoValue.value.trim() || undefined,
          { toast: false }
        )
        infoVisible.value = false
        replace(ROUTES.surveyDone, { id: p.id })
        return
      } catch (err) {
        const needInvite =
          p.rules.joinMethod === 'invite' && (err as { code?: number })?.code === 403
        if (!needInvite || attempt > 0) throw err

        const code = await invite.ask({
          // 校验放在弹层内部做：码错了留在原地抖动提示，不用收起再弹出
          validate: async (candidate) => {
            try {
              await joinPoll(p.id, candidate)
              return null
            } catch (e) {
              if ((e as { code?: number })?.code === 403) return '邀请码不正确，请重新输入'
              return (e as Error)?.message || '网络异常，请稍后重试'
            }
          }
        })
        if (!code) return
      }
    }
  } catch (err) {
    const msg = (err as Error)?.message || '提交失败，请重试'
    toast.error(msg)
  } finally {
    submitting.value = false
  }
}

onShareAppMessage(() =>
  poll.value ? buildShareMessage(poll.value) : { title: '杜雅轩', path: '/pages/index/index' }
)
</script>

<template>
  <view class="fill">
    <AppToast />
    <AppNavBar :back="true">
      <!-- 问卷填写页右上角不放分享图标：分享走微信胶囊转发 -->
    </AppNavBar>

    <view v-if="loading" class="fill__body">
      <AppSkeleton type="detail" />
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

    <template v-else-if="poll">
      <scroll-view class="fill__scroll" scroll-y>
        <view class="fill__content">
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

          <text class="fill__title">{{ poll.title }}</text>
          <text v-if="poll.desc" class="fill__desc">{{ poll.desc }}</text>

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

          <view class="fill__divider" />

          <view class="question">
            <text class="question__label">说说你的想法</text>
            <text class="question__hint">自由填写 · 最多 {{ MAX }} 字</text>
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
              <text class="area__tip">支持换行，最多 {{ MAX }} 字</text>
              <text class="area__count">{{ count }}/{{ MAX }}</text>
            </view>
          </view>

          <text v-if="canEditAfter && !isEnded" class="fill__note">
            提交后可在截止前修改这条回答。
          </text>
        </view>
      </scroll-view>

      <view class="fill__actions" :style="{ paddingBottom: bottomInset(20) }">
        <AppButton size="submit" :disabled="isEnded" :loading="submitting" @tap="onSubmit">
          {{ isEnded ? '问卷已截止' : '提交回答' }}
        </AppButton>
      </view>
    </template>

    <AppSheet
      :visible="infoVisible"
      title="填写信息后提交"
      desc="发起人要求参与者填写以下信息，仅发起人可见"
      :mask-closable="false"
      @close="infoVisible = false"
    >
      <view class="info-form">
        <view class="info-form__field">
          <text class="info-form__label">{{ poll?.rules.profileField }}</text>
          <view class="info-form__input">
            <input
              v-model="infoValue"
              :placeholder="`请输入你的${poll?.rules.profileField}`"
              placeholder-class="area__ph"
            />
          </view>
          <text class="info-form__hint">例如：张三 / 138****0000</text>
        </view>
      </view>

      <template #footer>
        <view class="info-form__ok">
          <AppButton size="compact" :disabled="!infoValue.trim()" :loading="submitting" @tap="doSubmit">
            确认并提交
          </AppButton>
        </view>
      </template>
    </AppSheet>

    <!-- 邀请码模式的问卷：和全站弹层同一套骨架，不再用原生 showModal -->
    <AppInviteCode
      :visible="invite.state.visible"
      :initial="invite.state.initial"
      :validating="invite.state.validating"
      :error="invite.state.error"
      :error-seq="invite.state.errorSeq"
      @close="invite.close()"
      @submit="invite.submit"
    />
  </view>
</template>

<script lang="ts">
export default { name: 'SurveyFillPage' }
</script>

<style lang="scss" scoped>
.fill {
  /* 定高：scroll-view 需要父级有确定高度，min-height 在真机上会让它塌成 0 高 */
  height: 100vh;
  /* #ifdef H5 */
  height: 100dvh;
  /* #endif */
  background: $bg;
  display: flex;
  flex-direction: column;

  &__nav-btn {
    width: 34px;
    height: 34px;
    border-radius: $r-circle;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    justify-content: center;
  }

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
    font-size: $fs-26;
    font-weight: 700;
    color: $ink;
    line-height: 1.32;
  }

  &__desc {
    font-size: $fs-13;
    color: $muted;
    line-height: 1.55;
  }

  &__divider {
    height: 1px;
    background: $line;
  }

  &__note {
    font-size: $fs-11;
    color: $faint;
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
    border-radius: $r-chip;
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
    font-size: $fs-11;
    font-weight: 600;
    color: $success;

    &--ended {
      color: $faint;
    }
  }

  &__chip {
    padding: 5px 8px;
    border-radius: $r-xs;
    background: $subtle;
    display: flex;
    align-items: center;

    &--warn {
      background: $warning-soft;
    }
  }

  &__chip-text {
    font-size: $fs-11;
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
    border-radius: $r-circle;
    background: $accent-soft;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__initial {
    font-size: $fs-13;
    font-weight: 700;
    color: $accent-ink;
  }

  &__info {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  &__name {
    font-size: $fs-12;
    font-weight: 600;
    color: $ink;
  }

  &__time {
    font-size: $fs-11;
    color: $faint;
  }
}

.question {
  display: flex;
  align-items: baseline;
  justify-content: space-between;

  &__label {
    font-size: $fs-13;
    font-weight: 600;
    color: $ink;
  }

  &__hint {
    font-size: $fs-12;
    color: $faint;
  }
}

.area {
  padding: 14px;
  border-radius: $r-input;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__box {
    height: 148px;
    padding: 12px;
    border-radius: $r-sm;
    background: $bg;
  }

  &__input {
    width: 100%;
    height: 100%;
    font-size: $fs-13;
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
    font-size: $fs-11;
    color: $faint;
  }
}

/* 需填信息表单（65）：字段间距 14，标签 12/500/$muted，输入框 44 高白底描边 */
.info-form {
  display: flex;
  flex-direction: column;
  gap: 14px;

  &__field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__label {
    font-size: $fs-12;
    font-weight: 500;
    color: $muted;
  }

  &__input {
    height: 44px;
    padding: 0 14px;
    border-radius: $r-md;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    font-size: $fs-14;
    color: $ink;
  }

  &__hint {
    font-size: $fs-10;
    color: $faint;
  }

  &__ok {
    width: 100%;
  }
}
</style>
