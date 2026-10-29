<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { Poll, PollRules } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import AppSwitch from '@/components/base/AppSwitch.vue'
import RuleRow from '@/components/business/RuleRow.vue'
import { fetchPoll, updatePoll } from '@/api/poll'
import { formatDateTime } from '@/utils/format'
import { bottomInset } from '@/utils/platform'
import { back } from '@/utils/router'
import { cacheDrop, cacheKey } from '@/utils/cache'

/**
 * 91 编辑投票 · 规则 / 94 编辑问卷 · 规则
 *
 * 这一页的核心不是「能改什么」，而是「什么改不了」。
 *
 * 锁定规则（写在后端也是同一套）：
 *   投票：选择方式、匿名、参与方式
 *   问卷：匿名收集、参与方式、允许重复提交，且问卷已截止时连截止时间也锁
 *
 * 为什么锁：这些字段决定已入库数据怎么解释。比如投票中途把「单选」改「多选」，
 * 之前的 42 张单选票就没法和后来的多选票放在一起统计。
 *
 * 锁定行标题转 $faint、开关置灰、说明换成「已有投票 / 已有回答，不能再改」，
 * 并且不弹任何提示——置灰本身就是提示，点一下再弹 Toast 是多余的。
 */
const poll = ref<Poll | null>(null)
const loading = ref(true)
const saving = ref(false)
const pollId = ref('')

const isSurvey = computed(() => poll.value?.type === 'survey')
const isEnded = computed(() => !!poll.value && poll.value.rules.endAt <= Date.now())
const responseCount = computed(() =>
  isSurvey.value ? poll.value?.answerCount ?? 0 : poll.value?.voterCount ?? 0
)
const hasResponses = computed(() => responseCount.value > 0)

/** 锁定的键 */
const lockedKeys = computed(() => {
  if (!hasResponses.value) return [] as string[]
  return isSurvey.value
    ? ['anonymous', 'joinMethod', 'allowRepeat', ...(isEnded.value ? ['endAt'] : [])]
    : ['type', 'anonymous', 'joinMethod']
})

function isLocked(key: string) {
  return lockedKeys.value.includes(key)
}

const lockedText = computed(() => (isSurvey.value ? '已有回答，不能再改' : '已有投票，不能再改'))

/** 参与方式只有两档：链接 / 邀请码（后端会把老数据的 group、private 归一成 invite） */
const joinText = computed(() =>
  poll.value?.rules.joinMethod === 'invite' ? '邀请码' : '链接分享'
)

/** 91 的快捷期限：剩余天数最接近的档位高亮 */
const activePreset = computed(() => {
  if (!poll.value) return 0
  const days = Math.round((poll.value.rules.endAt - Date.now()) / 86400000)
  return [1, 3, 7].includes(days) ? days : 0
})

const lockSummary = computed(() => {
  if (!hasResponses.value) return ''
  if (isSurvey.value) {
    const parts = ['匿名收集', '参与方式', '允许重复提交']
    if (isEnded.value) parts.push('截止时间（问卷已截止）')
    return `已锁定：${parts.join('、')}。其余开关随时可调。`
  }
  return '已锁定：选择方式、匿名、参与方式。其余开关随时可调，关闭后新规只对新票生效。'
})

async function load() {
  loading.value = true
  try {
    poll.value = await fetchPoll(pollId.value)
  } finally {
    loading.value = false
  }
}

onLoad((q) => {
  pollId.value = (q?.id as string) ?? ''
})
onMounted(load)

function setRule(key: keyof PollRules, v: boolean) {
  if (!poll.value || isLocked(key as string)) return
  ;(poll.value.rules as unknown as Record<string, boolean>)[key as string] = v
}

async function save() {
  if (!poll.value) return
  saving.value = true
  try {
    await updatePoll(poll.value.id, {
      title: poll.value.title,
      desc: poll.value.desc,
      type: poll.value.type,
      options: poll.value.options,
      rules: poll.value.rules
    })
    // 规则变了（截止时间、匿名、结果可见性），详情/结果快照都要重拉
    cacheDrop(cacheKey.pollAll(poll.value.id))
    uni.showToast({ title: '已保存', icon: 'none' })
    setTimeout(back, 600)
  } catch {
    uni.showToast({ title: '保存失败，请重试', icon: 'none' })
  } finally {
    saving.value = false
  }
}

function close() {
  back()
}

/** 已锁定的规则项点一下给出解释，而不是静默无反应 */
function lockedHint() {
  uni.showToast({ title: '编辑态沿用原设置', icon: 'none' })
}

/** 截止时间快捷选项；自定义时间只在创建时可选，编辑态给提示 */
function pickDeadline(p: { key?: number }) {
  if (isLocked('endAt')) {
    lockedHint()
    return
  }
  if (!poll.value) return
  if (p.key) poll.value.rules.endAt = Date.now() + p.key * 86400000
  else uni.showToast({ title: '自定义时间请在创建时设置', icon: 'none' })
}
</script>

<template>
  <view class="edit-rules">
    <AppNavBar :back="false">
      <template #left>
        <text class="edit-rules__close" @tap="close">关闭</text>
      </template>
      <template #title>
        <text class="edit-rules__nav-title">编辑{{ isSurvey ? '问卷' : '投票' }}</text>
      </template>
      <template #right>
        <view class="edit-rules__status">
          <text class="edit-rules__status-text">已发布</text>
        </view>
      </template>
    </AppNavBar>

    <view v-if="loading" class="edit-rules__body">
      <AppSkeleton type="detail" />
    </view>

    <scroll-view v-else-if="poll" class="edit-rules__scroll" scroll-y>
      <view class="edit-rules__inner">
        <view v-if="lockSummary" class="notice">
          <AppIcon name="triangle-alert" :size="16" color="#D97706" />
          <view class="notice__text">
            <text class="notice__title">
              {{ responseCount }} {{ isSurvey ? '条回答已入库' : '人已投票' }}，部分规则不能再改
            </text>
            <text class="notice__desc">{{ lockSummary }}</text>
          </view>
        </view>

        <view class="head">
          <text class="head__title">{{ isSurvey ? '问卷规则' : '投票规则' }}</text>
          <text class="head__sub">
            {{ isSurvey ? '决定谁能答、能否改、能否重复提交' : '决定谁能投、投几次、能否看到结果' }}
          </text>
        </view>

        <!-- 投票 -->
        <view v-if="!isSurvey" class="card">
          <RuleRow
            title="选择方式"
            :desc="isLocked('type') ? lockedText : poll.type === 'multiple' ? '每人可勾选多项' : '每人只能选 1 项'"
            :locked="isLocked('type')"
          >
            <view v-if="!isLocked('type')" class="seg">
              <view
                class="seg__item"
                :class="{ 'seg__item--on': poll.type === 'single' }"
                @tap="poll.type = 'single'"
              >
                <text class="seg__text" :class="{ 'seg__text--on': poll.type === 'single' }">单选</text>
              </view>
              <view
                class="seg__item"
                :class="{ 'seg__item--on': poll.type === 'multiple' }"
                @tap="poll.type = 'multiple'"
              >
                <text class="seg__text" :class="{ 'seg__text--on': poll.type === 'multiple' }">多选</text>
              </view>
            </view>
            <text v-else class="locked-value">
              {{ poll.type === 'multiple' ? '多选' : '单选' }}
            </text>
          </RuleRow>

          <RuleRow
            title="匿名投票"
            :desc="isLocked('anonymous') ? lockedText : '参与者身份不公开'"
            :locked="isLocked('anonymous')"
          >
            <AppSwitch
              :model-value="poll.rules.anonymous"
              :disabled="isLocked('anonymous')"
              @update:model-value="(v) => setRule('anonymous', v)"
            />
          </RuleRow>

          <RuleRow title="允许修改选择" desc="截止前可重新提交">
            <AppSwitch
              :model-value="poll.rules.allowEdit"
              @update:model-value="(v) => setRule('allowEdit', v)"
            />
          </RuleRow>

          <RuleRow title="选项随机排序" desc="每次打开顺序不同，减少位置影响">
            <AppSwitch
              :model-value="!!poll.rules.shuffleOptions"
              @update:model-value="(v) => setRule('shuffleOptions', v)"
            />
          </RuleRow>

          <RuleRow title="允许参与者分享" desc="参与者可转发邀请更多人">
            <AppSwitch
              :model-value="poll.rules.allowShare"
              @update:model-value="(v) => setRule('allowShare', v)"
            />
          </RuleRow>

          <RuleRow title="限制同IP投票" desc="同一网络下仅计入一票">
            <AppSwitch
              :model-value="poll.rules.limitIp"
              @update:model-value="(v) => setRule('limitIp', v)"
            />
          </RuleRow>

          <RuleRow title="禁止查看投票人数" desc="隐藏参与人数，只展示得票比例">
            <AppSwitch
              :model-value="!!poll.rules.hideVoterCount"
              @update:model-value="(v) => setRule('hideVoterCount', v)"
            />
          </RuleRow>

          <RuleRow
            title="投票结果显示"
            desc="决定参与者何时能看到票数"
            :value="
              poll.rules.resultVisibility === 'hidden'
                ? '禁止查看'
                : poll.rules.resultVisibility === 'after_end'
                  ? '投票结束后查看'
                  : poll.rules.resultVisibility === 'always'
                    ? '投票前查看'
                    : '投票后查看'
            "
            clickable
            @tap="lockedHint"
          />

          <RuleRow title="允许评论" desc="参与者可在讨论区留言交流">
            <AppSwitch
              :model-value="poll.rules.allowComment"
              @update:model-value="(v) => setRule('allowComment', v)"
            />
          </RuleRow>

          <RuleRow
            title="需个人信息"
            desc="参与前需填写发起人指定的信息"
            :value="poll.rules.profileField ?? '未设置'"
            clickable
            @tap="lockedHint"
          />

          <RuleRow
            title="参与方式"
            :desc="isLocked('joinMethod') ? lockedText : '谁可以看到并参与这个投票'"
            :locked="isLocked('joinMethod')"
          >
            <text class="locked-value">{{ joinText }}</text>
          </RuleRow>
        </view>

        <!-- 问卷 -->
        <view v-else class="card">
          <RuleRow
            title="匿名收集"
            :desc="isLocked('anonymous') ? lockedText : '回答者身份不公开'"
            :locked="isLocked('anonymous')"
          >
            <AppSwitch
              :model-value="poll.rules.anonymous"
              :disabled="isLocked('anonymous')"
              @update:model-value="(v) => setRule('anonymous', v)"
            />
          </RuleRow>

          <RuleRow title="允许修改回答" desc="提交后可编辑这条回答，总数不变">
            <AppSwitch
              :model-value="poll.rules.allowEdit"
              @update:model-value="(v) => setRule('allowEdit', v)"
            />
          </RuleRow>

          <RuleRow title="允许参与者分享" desc="参与者可转发邀请更多人">
            <AppSwitch
              :model-value="poll.rules.allowShare"
              @update:model-value="(v) => setRule('allowShare', v)"
            />
          </RuleRow>

          <RuleRow title="限制同IP提交" desc="同一网络下仅计入一份回答">
            <AppSwitch
              :model-value="poll.rules.limitIp"
              @update:model-value="(v) => setRule('limitIp', v)"
            />
          </RuleRow>

          <RuleRow title="允许评论" desc="参与者可在讨论区留言交流">
            <AppSwitch
              :model-value="poll.rules.allowComment"
              @update:model-value="(v) => setRule('allowComment', v)"
            />
          </RuleRow>

          <RuleRow
            title="允许重复提交"
            :desc="isLocked('allowRepeat') ? lockedText : '同一人可再提交新的一条，独立计入总数'"
            :locked="isLocked('allowRepeat')"
          >
            <AppSwitch
              :model-value="!!poll.rules.allowRepeat"
              :disabled="isLocked('allowRepeat')"
              @update:model-value="(v) => setRule('allowRepeat', v)"
            />
          </RuleRow>

          <RuleRow
            title="需个人信息"
            desc="参与前需填写发起人指定的信息"
            :value="poll.rules.profileField ?? '未设置'"
            clickable
            @tap="lockedHint"
          />

          <RuleRow
            title="参与方式"
            :desc="isLocked('joinMethod') ? lockedText : '谁可以看到并参与这份问卷'"
            :locked="isLocked('joinMethod')"
          >
            <text class="locked-value">{{ joinText }}</text>
          </RuleRow>
        </view>

        <!-- 截止时间：独立一节，不在规则卡里 -->
        <view class="deadline">
          <view class="deadline__head">
            <text class="deadline__title">截止时间</text>
            <text class="deadline__hint">{{ isLocked('endAt') ? '已锁定' : '必填' }}</text>
          </view>

          <view class="deadline__chips">
            <view
              v-for="p in [
                { key: 1, label: '1 天' },
                { key: 3, label: '3 天' },
                { key: 7, label: '7 天' },
                { key: 0, label: '自定义' }
              ]"
              :key="p.label"
              class="chip"
              :class="{
                'chip--on': activePreset === p.key && !isLocked('endAt'),
                'chip--off': isLocked('endAt')
              }"
              @tap="pickDeadline(p)"
            >
              <text
                class="chip__text"
                :class="{ 'chip__text--on': activePreset === p.key && !isLocked('endAt') }"
              >
                {{ p.label }}
              </text>
            </view>
          </view>

          <view class="deadline__value" :class="{ 'deadline__value--off': isLocked('endAt') }" @tap="pickDeadline({ key: 0 })">
            <AppIcon name="calendar-clock" :size="16" color="#71717A" />
            <text class="deadline__value-text">
              {{ formatDateTime(poll.rules.endAt) }}{{ isEnded ? ' · 已截止' : '' }}
            </text>
            <AppIcon name="chevron-right" :size="15" color="#A1A1AA" />
          </view>
        </view>
      </view>
    </scroll-view>

    <view v-if="poll" class="edit-rules__actions" :style="{ paddingBottom: bottomInset(20) }">
      <AppButton type="subtle" size="action" :radius="14" class="edit-rules__action" @tap="close">取消</AppButton>
      <AppButton size="submit" :loading="saving" class="edit-rules__action" @tap="save">保存修改</AppButton>
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'EditRulesPage' }
</script>

<style lang="scss" scoped>
.edit-rules {
  /* 定高：scroll-view 需要父级有确定高度，min-height 在真机上会让它塌成 0 高 */
  height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  &__close {
    font-size: 14px;
    color: $muted;
  }

  &__nav-title {
    font-size: 16px;
    font-weight: 600;
    color: $ink;
  }

  /* 已发布标记：浅紫胶囊，11/600 */
  &__status {
    padding: 5px 10px;
    border-radius: 8px;
    background: $accent-soft;
    display: flex;
    align-items: center;
  }

  &__status-text {
    font-size: 11px;
    font-weight: 600;
    color: $accent;
  }

  &__body {
    flex: 1;
  }

  &__scroll {
    flex: 1;
    height: 0;
  }

  &__inner {
    padding: 4px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* 91/94：取消 14 圆角白底、保存 16 圆角紫底，两个等宽 */
  &__actions {
    display: flex;
    gap: 10px;
    /* 下边距由 bottomInset() 内联控制 */
    padding: 8px $gutter 0;
    flex-shrink: 0;
  }

  &__action {
    flex: 1;
  }
}

/* 提示条：r12 pad[12,14] gap10，图标与两行文案并排 */
.notice {
  padding: 12px 14px;
  border-radius: 12px;
  background: $warning-soft;
  display: flex;
  align-items: flex-start;
  gap: 10px;

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  &__title {
    font-size: 12px;
    font-weight: 600;
    color: $warning;
  }

  &__desc {
    font-size: 11px;
    color: $muted;
    line-height: 1.5;
  }
}

.head {
  display: flex;
  flex-direction: column;
  gap: 6px;

  &__title {
    font-size: 20px;
    font-weight: 700;
    color: $ink;
  }

  &__sub {
    font-size: 12px;
    color: $muted;
  }
}

.card {
  background: $surface;
  border: 1px solid $line;
  border-radius: 16px;
  overflow: hidden;
}

.seg {
  display: flex;
  background: $subtle;
  border-radius: 9px;
  padding: 3px;
  gap: 3px;
  flex-shrink: 0;

  &__item {
    padding: 5px 10px;
    border-radius: 7px;
    display: flex;
    align-items: center;

    &--on {
      background: $surface;
    }
  }

  &__text {
    font-size: 12px;
    color: $muted;

    &--on {
      color: $ink;
      font-weight: 600;
    }
  }
}

.locked-value {
  font-size: 12px;
  color: $muted;
  flex-shrink: 0;

  &--faint {
    color: $faint;
  }
}

.deadline {
  display: flex;
  flex-direction: column;
  gap: 9px;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    font-size: 12px;
    font-weight: 600;
    color: $ink;
  }

  &__hint {
    font-size: 10px;
    color: $faint;
  }

  &__chips {
    display: flex;
    gap: 8px;
  }

  /* 91 的日期行：52 高、10 圆角、图标 + 时间 + 箭头 */
  &__value {
    height: 52px;
    padding: 0 14px;
    border-radius: 10px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    gap: 10px;

    &--off {
      background: $subtle;
      border-color: $subtle;
    }
  }

  &__value-text {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
    color: $ink;
  }

  &__value--off &__value-text {
    color: $faint;
  }
}

.chip {
  flex: 1;
  padding: 10px 0;
  border-radius: 10px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  justify-content: center;

  &--on {
    background: $accent;
    border-color: $accent;
  }

  &--off {
    background: $subtle;
    border-color: $subtle;
  }

  &__text {
    font-size: 12px;
    font-weight: 500;
    color: $muted;

    &--on {
      font-weight: 600;
      color: #fff;
    }
  }
}
</style>
