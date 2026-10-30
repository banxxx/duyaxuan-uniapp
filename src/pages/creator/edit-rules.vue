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
import AppDateTimePicker from '@/components/base/AppDateTimePicker.vue'
import AppActionSheet from '@/components/base/AppActionSheet.vue'
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
 *   投票类型：创建后永远不能改 —— 单选票和多选票没法放在一起统计
 *   已有参与记录：匿名、参与方式、问卷的重复提交、多选的选项上限；截止时间只能延后
 *   已结束：规则全部锁定，只能回内容页修改主题和说明
 *
 * 为什么锁：这些字段决定已入库数据怎么解释。比如投票中途把「单选」改「多选」，
 * 之前的 42 张单选票就没法和后来的多选票放在一起统计。
 *
 * 锁定行标题转 $faint、开关置灰、说明换成「已有投票 / 已有回答，不能再改」，
 * 并且不弹任何提示——置灰本身就是提示，点一下再弹 Toast 是多余的。
 */
const poll = ref<Poll | null>(null)
const loading = ref(true)
/** 首屏加载失败：给错误页和重试，不要停在空白页 */
const loadError = ref(false)
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
  // 已结束：规则全部锁死，只留主题/说明可改
  if (isEnded.value) {
    return [
      'type',
      'anonymous',
      'allowEdit',
      'allowShare',
      'allowComment',
      'allowRepeat',
      'limitIp',
      'maxChoice',
      'resultVisibility',
      'shuffleOptions',
      'hideVoterCount',
      'joinMethod',
      'profileField',
      'endAt'
    ]
  }
  // 类型任何时候都不能改；参与过之后，决定「数据怎么解释」的字段跟着锁
  const base = ['type']
  if (!hasResponses.value) return base
  return isSurvey.value
    ? [...base, 'anonymous', 'joinMethod', 'allowRepeat']
    : [...base, 'anonymous', 'joinMethod', 'maxChoice']
})

function isLocked(key: string) {
  return lockedKeys.value.includes(key)
}

const lockedText = computed(() =>
  isEnded.value
    ? isSurvey.value
      ? '问卷已结束，不能再改'
      : '投票已结束，不能再改'
    : isSurvey.value
      ? '已有回答，不能再改'
      : '已有投票，不能再改'
)

/** 锁定原因：投票类型是「创建后不可改」，和「已有参与记录」不是一回事 */
function lockReason(key: string) {
  if (!isLocked(key)) return ''
  if (key === 'type' && !isEnded.value && !hasResponses.value) return '投票类型创建后不可修改'
  return lockedText.value
}

/** 行说明：锁定时换成原因，未锁定时用原本的功能说明 */
function ruleDesc(key: string, normal: string) {
  return isLocked(key) ? lockReason(key) : normal
}

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
  if (isEnded.value) {
    return `${isSurvey.value ? '问卷' : '投票'}已结束，规则和截止时间都已锁定，只能修改主题和说明。`
  }
  if (!hasResponses.value) return ''
  if (isSurvey.value) {
    return '已锁定：匿名收集、参与方式、允许重复提交；截止时间只能延后。其余开关随时可调。'
  }
  return '已锁定：投票类型、匿名、参与方式、最多可选；截止时间只能延后。其余开关随时可调，关闭后新规只对新票生效。'
})

/** 投票结果显示：右侧展示当前值，点开用自定义底部菜单改 */
const visibilityText = computed(() => {
  switch (poll.value?.rules.resultVisibility) {
    case 'hidden':
      return '禁止查看'
    case 'after_end':
      return '投票结束后查看'
    case 'always':
      return '投票前查看'
    default:
      return '投票后查看'
  }
})

const RESULT_VISIBILITY: Array<{ value: NonNullable<PollRules['resultVisibility']>; label: string }> = [
  { value: 'always', label: '投票前查看' },
  { value: 'after_vote', label: '投票后查看' },
  { value: 'after_end', label: '投票结束后查看' },
  { value: 'hidden', label: '禁止查看' }
]

const visibilityVisible = ref(false)
const visibilityItems = computed(() =>
  RESULT_VISIBILITY.map((o) => ({
    key: o.value,
    label: o.label,
    selected: poll.value?.rules.resultVisibility === o.value
  }))
)

function pickVisibility() {
  if (!poll.value || isLocked('resultVisibility')) return
  visibilityVisible.value = true
}

function onVisibility(key: string) {
  if (!poll.value) return
  const hit = RESULT_VISIBILITY.find((o) => o.value === key)
  if (hit) poll.value.rules.resultVisibility = hit.value
}

/** 参与方式：响应后锁定，结束更不用说了 */
const joinVisible = ref(false)
const joinItems = computed(() => [
  {
    key: 'link',
    label: '链接分享',
    desc: '拿到链接的人都能参与',
    selected: poll.value?.rules.joinMethod !== 'invite'
  },
  {
    key: 'invite',
    label: '邀请码',
    desc: '参与者需单独输入 6 位码，转发链接也进不来',
    selected: poll.value?.rules.joinMethod === 'invite'
  }
])

function pickJoinMethod() {
  if (!poll.value || isLocked('joinMethod')) return
  joinVisible.value = true
}

function onJoinMethod(key: string) {
  if (!poll.value) return
  if (key === 'link' || key === 'invite') poll.value.rules.joinMethod = key
}

/* ---------------- 最多可选（多选） ---------------- */

// 上限取「选项数」和「当前值」的较大者：删过没人投的选项后，旧上限可能比选项数大，
// 强行收窄会在保存时被后端判成「修改了选择上限」而拒绝，这里保留原值不乱动。
const maxChoiceMax = computed(() =>
  Math.max(2, poll.value?.options.length ?? 2, poll.value?.rules.maxChoice ?? 0)
)
const maxChoiceValue = computed(() => {
  const v = poll.value?.rules.maxChoice
  return Math.min(Math.max(2, typeof v === 'number' ? v : 3), maxChoiceMax.value)
})

function stepMaxChoice(delta: number) {
  if (!poll.value || isLocked('maxChoice')) return
  const next = Math.min(Math.max(2, maxChoiceValue.value + delta), maxChoiceMax.value)
  if (next === maxChoiceValue.value) return
  poll.value.rules.maxChoice = next
}

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

function setRule(key: keyof PollRules, v: boolean) {
  if (!poll.value || isLocked(key as string)) return
  ;(poll.value.rules as unknown as Record<string, boolean>)[key as string] = v
}

async function save() {
  if (!poll.value) return
  saving.value = true
  try {
    // 这一页永远不碰选项和类型：规则改动不需要把选项再传一遍。
    // 已结束时 rules 也全部锁定，只回存主题/说明。
    const body: Record<string, any> = {
      title: poll.value.title,
      desc: poll.value.desc
    }
    if (!isEnded.value) body.rules = poll.value.rules
    await updatePoll(poll.value.id, body)
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
  uni.showToast({ title: lockedText.value, icon: 'none' })
}

/* ---------------- 截止时间 ---------------- */

/** 有参与记录后只能延后：快捷档位从「现在」改成「从当前截止时间往后加」 */
const deadlinePresets = computed(() =>
  hasResponses.value && !isEnded.value
    ? [
        { key: 1, label: '延长 1 天' },
        { key: 3, label: '延长 3 天' },
        { key: 7, label: '延长 7 天' },
        { key: 0, label: '自定义' }
      ]
    : [
        { key: 1, label: '1 天' },
        { key: 3, label: '3 天' },
        { key: 7, label: '7 天' },
        { key: 0, label: '自定义' }
      ]
)

/** 自定义面板打开时的草稿值；只有点「确定」才写回 */
const deadlinePicker = ref(false)
const customDeadline = ref(0)

/** 自定义面板的最早可选时间：有参与记录时就是当前截止时间 */
const deadlineMin = computed(() => {
  if (!poll.value) return Date.now()
  return hasResponses.value ? Math.max(Date.now(), poll.value.rules.endAt) : Date.now()
})

function pickDeadline(p: { key?: number }) {
  if (isLocked('endAt')) {
    lockedHint()
    return
  }
  if (!poll.value) return
  if (!p.key) {
    customDeadline.value = Math.max(poll.value.rules.endAt, Date.now() + 3600000)
    deadlinePicker.value = true
    return
  }
  const base = hasResponses.value ? poll.value.rules.endAt : Date.now()
  poll.value.rules.endAt = base + p.key * 86400000
}

function applyCustomDeadline(ts: number) {
  if (!poll.value) return
  if (ts <= deadlineMin.value) {
    uni.showToast({
      title: hasResponses.value ? '已有参与记录，截止时间只能延后' : '请选择未来的时间',
      icon: 'none'
    })
    return
  }
  poll.value.rules.endAt = ts
  deadlinePicker.value = false
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

    <AppEmpty
      v-else-if="loadError"
      icon="wifi-off"
      title="加载失败"
      desc="网络不太稳定，或者这条投票已经被删除"
      action="重新加载"
      action-icon="refresh-cw"
      @action="load"
    />

    <scroll-view v-else-if="poll" class="edit-rules__scroll" scroll-y>
      <view class="edit-rules__inner">
        <view v-if="lockSummary" class="notice">
          <AppIcon name="triangle-alert" :size="16" color="#D97706" />
          <view class="notice__text">
            <text class="notice__title">
              {{
                isEnded
                  ? `${isSurvey ? '问卷' : '投票'}已结束，规则已全部锁定`
                  : `${responseCount} ${isSurvey ? '条回答已入库' : '人已投票'}，部分规则不能再改`
              }}
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
            :desc="isLocked('type') ? lockReason('type') : poll.type === 'multiple' ? '每人可勾选多项' : '每人只能选 1 项'"
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
            v-if="poll.type === 'multiple'"
            title="最多可选"
            :desc="isLocked('maxChoice') ? lockReason('maxChoice') : `最多 ${maxChoiceMax} 项，超过上限时禁止继续勾选`"
            :locked="isLocked('maxChoice')"
          >
            <view class="stepper">
              <view
                class="stepper__btn"
                :class="{ 'stepper__btn--off': isLocked('maxChoice') || maxChoiceValue <= 2 }"
                :hover-class="isLocked('maxChoice') || maxChoiceValue <= 2 ? 'none' : 'stepper__btn--active'"
                @tap="stepMaxChoice(-1)"
              >
                <AppIcon name="minus" :size="13" color="#71717A" />
              </view>
              <text class="stepper__value">{{ maxChoiceValue }}</text>
              <view
                class="stepper__btn"
                :class="{ 'stepper__btn--off': isLocked('maxChoice') || maxChoiceValue >= maxChoiceMax }"
                :hover-class="isLocked('maxChoice') || maxChoiceValue >= maxChoiceMax ? 'none' : 'stepper__btn--active'"
                @tap="stepMaxChoice(1)"
              >
                <AppIcon name="plus" :size="13" color="#09090B" />
              </view>
            </view>
          </RuleRow>

          <RuleRow
            title="匿名投票"
            :desc="ruleDesc('anonymous', '参与者身份不公开')"
            :locked="isLocked('anonymous')"
          >
            <AppSwitch
              :model-value="poll.rules.anonymous"
              :disabled="isLocked('anonymous')"
              @update:model-value="(v) => setRule('anonymous', v)"
            />
          </RuleRow>

          <RuleRow
            title="允许修改选择"
            :desc="ruleDesc('allowEdit', '截止前可重新提交')"
            :locked="isLocked('allowEdit')"
          >
            <AppSwitch
              :model-value="poll.rules.allowEdit"
              :disabled="isLocked('allowEdit')"
              @update:model-value="(v) => setRule('allowEdit', v)"
            />
          </RuleRow>

          <RuleRow
            title="选项随机排序"
            :desc="ruleDesc('shuffleOptions', '每次打开顺序不同，减少位置影响')"
            :locked="isLocked('shuffleOptions')"
          >
            <AppSwitch
              :model-value="!!poll.rules.shuffleOptions"
              :disabled="isLocked('shuffleOptions')"
              @update:model-value="(v) => setRule('shuffleOptions', v)"
            />
          </RuleRow>

          <RuleRow
            title="允许参与者分享"
            :desc="ruleDesc('allowShare', '参与者可转发邀请更多人')"
            :locked="isLocked('allowShare')"
          >
            <AppSwitch
              :model-value="poll.rules.allowShare"
              :disabled="isLocked('allowShare')"
              @update:model-value="(v) => setRule('allowShare', v)"
            />
          </RuleRow>

          <RuleRow
            title="限制同IP投票"
            :desc="ruleDesc('limitIp', '同一网络下仅计入一票')"
            :locked="isLocked('limitIp')"
          >
            <AppSwitch
              :model-value="poll.rules.limitIp"
              :disabled="isLocked('limitIp')"
              @update:model-value="(v) => setRule('limitIp', v)"
            />
          </RuleRow>

          <RuleRow
            title="禁止查看投票人数"
            :desc="ruleDesc('hideVoterCount', '隐藏参与人数，只展示得票比例')"
            :locked="isLocked('hideVoterCount')"
          >
            <AppSwitch
              :model-value="!!poll.rules.hideVoterCount"
              :disabled="isLocked('hideVoterCount')"
              @update:model-value="(v) => setRule('hideVoterCount', v)"
            />
          </RuleRow>

          <RuleRow
            title="投票结果显示"
            :desc="isLocked('resultVisibility') ? lockReason('resultVisibility') : '决定参与者何时能看到票数'"
            :value="visibilityText"
            :locked="isLocked('resultVisibility')"
            :clickable="!isLocked('resultVisibility')"
            @tap="pickVisibility"
          />

          <RuleRow
            title="允许评论"
            :desc="ruleDesc('allowComment', '参与者可在讨论区留言交流')"
            :locked="isLocked('allowComment')"
          >
            <AppSwitch
              :model-value="poll.rules.allowComment"
              :disabled="isLocked('allowComment')"
              @update:model-value="(v) => setRule('allowComment', v)"
            />
          </RuleRow>

          <RuleRow
            title="需个人信息"
            desc="参与前需填写发起人指定的信息，创建后不可修改"
            :value="poll.rules.profileField ?? '未设置'"
            locked
          />

          <RuleRow
            title="参与方式"
            :desc="isLocked('joinMethod') ? lockReason('joinMethod') : '谁可以看到并参与这个投票'"
            :locked="isLocked('joinMethod')"
            :clickable="!isLocked('joinMethod')"
            @tap="pickJoinMethod"
          >
            <text class="locked-value">{{ joinText }}</text>
          </RuleRow>
        </view>

        <!-- 问卷 -->
        <view v-else class="card">
          <RuleRow
            title="匿名收集"
            :desc="ruleDesc('anonymous', '回答者身份不公开')"
            :locked="isLocked('anonymous')"
          >
            <AppSwitch
              :model-value="poll.rules.anonymous"
              :disabled="isLocked('anonymous')"
              @update:model-value="(v) => setRule('anonymous', v)"
            />
          </RuleRow>

          <RuleRow
            title="允许修改回答"
            :desc="ruleDesc('allowEdit', '提交后可编辑这条回答，总数不变')"
            :locked="isLocked('allowEdit')"
          >
            <AppSwitch
              :model-value="poll.rules.allowEdit"
              :disabled="isLocked('allowEdit')"
              @update:model-value="(v) => setRule('allowEdit', v)"
            />
          </RuleRow>

          <RuleRow
            title="允许参与者分享"
            :desc="ruleDesc('allowShare', '参与者可转发邀请更多人')"
            :locked="isLocked('allowShare')"
          >
            <AppSwitch
              :model-value="poll.rules.allowShare"
              :disabled="isLocked('allowShare')"
              @update:model-value="(v) => setRule('allowShare', v)"
            />
          </RuleRow>

          <RuleRow
            title="限制同IP提交"
            :desc="ruleDesc('limitIp', '同一网络下仅计入一份回答')"
            :locked="isLocked('limitIp')"
          >
            <AppSwitch
              :model-value="poll.rules.limitIp"
              :disabled="isLocked('limitIp')"
              @update:model-value="(v) => setRule('limitIp', v)"
            />
          </RuleRow>

          <RuleRow
            title="允许评论"
            :desc="ruleDesc('allowComment', '参与者可在讨论区留言交流')"
            :locked="isLocked('allowComment')"
          >
            <AppSwitch
              :model-value="poll.rules.allowComment"
              :disabled="isLocked('allowComment')"
              @update:model-value="(v) => setRule('allowComment', v)"
            />
          </RuleRow>

          <RuleRow
            title="允许重复提交"
            :desc="ruleDesc('allowRepeat', '同一人可再提交新的一条，独立计入总数')"
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
            desc="参与前需填写发起人指定的信息，创建后不可修改"
            :value="poll.rules.profileField ?? '未设置'"
            locked
          />

          <RuleRow
            title="参与方式"
            :desc="isLocked('joinMethod') ? lockReason('joinMethod') : '谁可以看到并参与这份问卷'"
            :locked="isLocked('joinMethod')"
            :clickable="!isLocked('joinMethod')"
            @tap="pickJoinMethod"
          >
            <text class="locked-value">{{ joinText }}</text>
          </RuleRow>
        </view>

        <!-- 截止时间：独立一节，不在规则卡里 -->
        <view class="deadline">
          <view class="deadline__head">
            <text class="deadline__title">截止时间</text>
            <text class="deadline__hint">
              {{ isLocked('endAt') ? '已锁定' : hasResponses ? '只能延后' : '必填' }}
            </text>
          </view>

          <view class="deadline__chips">
            <view
              v-for="p in deadlinePresets"
              :key="p.label"
              class="chip"
              :class="{
                'chip--on': activePreset === p.key && !isLocked('endAt') && !hasResponses,
                'chip--off': isLocked('endAt')
              }"
              @tap="pickDeadline(p)"
            >
              <text
                class="chip__text"
                :class="{ 'chip__text--on': activePreset === p.key && !isLocked('endAt') && !hasResponses }"
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
      <AppButton size="submit" :loading="saving" :disabled="isEnded" class="edit-rules__action" @tap="save">
        {{ isEnded ? '已结束' : '保存修改' }}
      </AppButton>
    </view>

    <!-- 34/35 自定义截止时间：有参与记录时 min 为当前截止时间，选早了会在确认时被拦下 -->
    <AppDateTimePicker
      :visible="deadlinePicker"
      :model-value="customDeadline"
      :min="deadlineMin"
      @close="deadlinePicker = false"
      @confirm="applyCustomDeadline"
    />

    <AppActionSheet
      :visible="visibilityVisible"
      title="投票结果显示"
      desc="决定参与者何时能看到票数"
      :items="visibilityItems"
      @close="visibilityVisible = false"
      @select="onVisibility"
    />

    <AppActionSheet
      :visible="joinVisible"
      title="参与方式"
      desc="谁可以看到并参与"
      :items="joinItems"
      @close="joinVisible = false"
      @select="onJoinMethod"
    />
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

/* 最多可选：和创建页 31 同一个 Stepper（白底、$line 描边、r8、30 高） */
.stepper {
  display: flex;
  align-items: center;
  height: 30px;
  border-radius: 8px;
  background: $surface;
  border: 1px solid $line;
  flex-shrink: 0;

  &__btn {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;

    &--active {
      opacity: 0.6;
    }

    &--off {
      opacity: 0.3;
    }
  }

  &__value {
    width: 32px;
    text-align: center;
    font-size: 13px;
    font-weight: 600;
    color: $ink;
    font-family: $font-num;
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
      color: $white;
    }
  }
}
</style>
