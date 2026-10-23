<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onLoad, onShow, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app'
import type { Poll, Comment, SurveyAnswer } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppAvatar from '@/components/base/AppAvatar.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSheet from '@/components/base/AppSheet.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import OptionBar from '@/components/business/OptionBar.vue'
import {
  fetchPoll,
  fetchMyVote,
  votePoll,
  revokeVote,
  fetchComments,
  fetchMyAnswers,
  fetchAnswers,
  fetchVoters
} from '@/api/poll'
import { useUserStore } from '@/stores/user'
import { formatCreatedAt, formatRemaining, formatRelative, charCount, percent } from '@/utils/format'
import { buildShareMessage, buildTimelineMessage } from '@/utils/share'
import { bottomInset } from '@/utils/platform'
import { backTo, go, replace, ROUTES } from '@/utils/router'

/**
 * 详情页 —— 05~12、16~20、22~23、67~70、75~76 全部合成这一页
 *
 * 设计稿把它拆成十几屏，是因为要覆盖所有状态组合；实现上只有一屏，
 * 由四个布尔量决定长什么样：
 *   isOwner    发起人 → 署名「我发起的」，底部多一个「投票数据」
 *   hasVoted   已投票 → 选项条只读、显示结果（或结果暂不可见）
 *   canSeeResult 结果可见 → 已投票后显示票数，否则只显示我选了什么
 *   isEnded    已结束 → 去掉撤回、去掉「确认投票」
 *
 * 问卷（survey）的「待填写」不在这里：那是 64，独立一页 survey/fill。
 * 打开一份还没填的问卷时本页会 redirect 过去，保证入口唯一。
 */

const user = useUserStore()

const poll = ref<Poll | null>(null)
const myVote = ref<string[]>([])
const myAnswers = ref<SurveyAnswer[]>([])
const comments = ref<Comment[]>([])
const loading = ref(true)
const submitting = ref(false)
const selection = ref<string[]>([])

/** 16 / 65：需填信息弹层 */
const infoVisible = ref(false)
const infoValue = ref('')

const pollId = ref('')

const isOwner = computed(() => !!poll.value && poll.value.creatorId === user.profile?.id)
const isSurvey = computed(() => poll.value?.type === 'survey')
const isEnded = computed(() => !!poll.value && poll.value.rules.endAt <= Date.now())
const hasVoted = computed(() => (isSurvey.value ? myAnswers.value.length > 0 : myVote.value.length > 0))

/** 结果能不能看见：发起人永远能看见；参与者看 resultVisibility */
const canSeeResult = computed(() => {
  const p = poll.value
  if (!p) return false
  if (isOwner.value) return true
  const v = p.rules.resultVisibility ?? 'after_vote'
  if (v === 'hidden') return false
  if (v === 'always') return true
  if (v === 'after_end') return isEnded.value
  return hasVoted.value
})

/** 上限以规则里的 maxChoice 为准（创建时设定），老数据没有该字段时按 3 兜底 */
const maxChoice = computed(() => {
  if (poll.value?.type !== 'multiple') return 1
  return poll.value.rules.maxChoice ?? 3
})
const totalVotes = computed(() => poll.value?.options.reduce((s, o) => s + o.votes, 0) ?? 0)

const metaText = computed(() => {
  const p = poll.value
  if (!p) return ''
  const kind = p.type === 'survey' ? '匿名收集' : '匿名投票'
  return formatCreatedAt(p.createdAt, `创建 · ${p.rules.anonymous ? '匿名' : '公开'}${kind.slice(2)}`)
})

const liveText = computed(() =>
  isEnded.value ? '已结束' : `进行中 · ${formatRemaining(poll.value!.rules.endAt)}`
)

/** 09/11 底部的「剩 3 天 6 小时」 */
const remainingText = computed(() => (poll.value ? formatRemaining(poll.value.rules.endAt) : ''))

/** 09/11 讨论区只露两条 */
const previewComments = computed(() => comments.value.slice(0, 2))

/**
 * 09/11 的参与入口左侧叠了四个头像。
 * 投票取投票人、问卷取回答人；接口按页返回，只取前四个够用。
 */
const voterAvatars = ref<Array<{ id: string; name: string; avatar?: string }>>([])

/** 投票进行中、且我没投：07/08 先露一份实时行情（Standings） */
const showStandings = computed(
  () => !isSurvey.value && !hasVoted.value && !isEnded.value && canSeeResult.value
)

const standings = computed(() => {
  const opts = [...(poll.value?.options ?? [])].sort((a, b) => b.votes - a.votes)
  const total = totalVotes.value
  return opts.map((o) => ({ ...o, pct: percent(o.votes, total) }))
})

/** 领先第二名多少个百分点，0 票时不给这句 */
const leadGap = computed(() => {
  const list = standings.value
  if (list.length < 2 || totalVotes.value === 0) return 0
  return Math.max(0, list[0].pct - list[1].pct)
})

/** 07 Standings 的分段条按名次上色：第 1 名 $accent，往后依次变浅 */
const SEG_COLORS = ['#4F46E5', '#8B84F2', '#BEB9F8', '#D4D4D8']

/** 已选数量：已投票时按我投的算，未投时按当前勾选算 */
const count = computed(() => (hasVoted.value ? myVote.value.length : selection.value.length))

/**
 * 选项条的四种形态（见 OptionBar 注释）：
 *   已投票 + 结果可见 → result（带进度条）
 *   已投票 + 结果隐藏 → locked（52 高紧凑行）
 *   未投票 + 结果可见 → vote-result（行尾带票数，07/08）
 *   未投票 + 结果隐藏 → vote（05/06）
 */
const optionMode = computed(() => {
  if (hasVoted.value) return canSeeResult.value ? 'result' : 'locked'
  return canSeeResult.value && !isEnded.value ? 'vote-result' : 'vote'
})

/** 选项列表的间距跟着形态走：05/07 是 10，09/11 是 12，10/12 是 8 */
const optionGap = computed(() => {
  if (!hasVoted.value) return ''
  return canSeeResult.value ? 'options--result' : 'options--tight'
})

const myAnswer = computed(() => myAnswers.value[0] ?? null)

/** 已提交的问卷：能不能再改 */
const canEditAnswer = computed(() => !!poll.value?.rules.allowEdit && !isEnded.value)
const canRepeat = computed(() => !!poll.value?.rules.allowRepeat && !isEnded.value)

/** 底部主按钮文案与可用性 */
const submitDisabled = computed(() => {
  if (isEnded.value) return true
  if (selection.value.length < 1) return true
  if (poll.value?.type === 'single' && selection.value.length > 1) return true
  return false
})

async function load() {
  loading.value = true
  try {
    const p = await fetchPoll(pollId.value)
    poll.value = p

    // 问卷且我还没答过、也不是发起人 → 直接去填写页，避免出现一个空壳详情
    if (p.type === 'survey') {
      const answers = await fetchMyAnswers(p.id)
      myAnswers.value = answers
      if (!answers.length && p.creatorId !== user.profile?.id && p.rules.endAt > Date.now()) {
        replace(ROUTES.surveyFill, { id: p.id })
        return
      }
    } else {
      myVote.value = await fetchMyVote(p.id)
      // 从别的页面退回来时不清空用户已经点选但还没提交的选择 ——
      // 否则去评论区看一眼再回来，选项全没了
      if (!selection.value.length) selection.value = [...myVote.value]
    }

    if (p.rules.allowComment) {
      comments.value = await fetchComments(p.id)
    }

    // 参与入口的头像叠层：投票取投票人，问卷取回答人（匿名时为各自的占位字）
    if (hasVoted.value || isOwner.value) {
      if (p.type === 'survey') {
        const page = await fetchAnswers(p.id)
        voterAvatars.value = page.list
          .slice(0, 4)
          .map((a, i) => a.user ?? { id: `anon${i}`, name: '匿' })
      } else {
        const voters = await fetchVoters(p.id)
        voterAvatars.value = voters.slice(0, 4).map((v, i) => v.user ?? { id: `anon${i}`, name: '匿' })
      }
    }
  } catch {
    uni.showToast({ title: '加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

onLoad((query) => {
  pollId.value = (query?.id as string) ?? ''
})

onMounted(() => {
  if (!pollId.value) {
    uni.showToast({ title: '参数错误', icon: 'none' })
    return
  }
  load()
})

/**
 * 从成功页 / 结果页 / 投票记录页退回来时要刷新。
 *
 * 这些页面都会改票数或投票状态（刚投完、撤回、别人投了），
 * 而返回是复用同一个页面实例，不重新 mount —— 不在这里重拉，
 * 用户看到的就是投票前的旧数据。
 */
let firstShow = true
onShow(() => {
  if (firstShow) {
    firstShow = false
    return
  }
  if (pollId.value) load()
})

/* ---------- 选项交互 ---------- */

function selectOption(id: string) {
  if (hasVoted.value || isEnded.value) return
  const p = poll.value
  if (!p) return

  if (p.type === 'single') {
    selection.value = [id]
    return
  }

  const idx = selection.value.indexOf(id)
  if (idx >= 0) selection.value.splice(idx, 1)
  else if (selection.value.length < maxChoice.value) selection.value.push(id)
  else uni.showToast({ title: `最多选 ${maxChoice.value} 项`, icon: 'none' })
}

/** 05/06 的「确认投票」；需要填信息时先弹 16 */
function onSubmit() {
  if (submitDisabled.value) return
  if (poll.value?.rules.profileField) {
    infoVisible.value = true
    return
  }
  doVote()
}

async function doVote() {
  if (!poll.value) return
  submitting.value = true
  try {
    const next = await votePoll(poll.value.id, selection.value)
    poll.value = next
    myVote.value = [...selection.value]
    infoVisible.value = false
    go(ROUTES.detailSuccess, { id: poll.value.id })
  } catch {
    uni.showToast({ title: '投票失败，请重试', icon: 'none' })
  } finally {
    submitting.value = false
  }
}

/** 09/11 的「撤回」：仅「允许修改选择」且未截止时出现 */
async function onRevoke() {
  if (!poll.value) return
  const res = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '撤回这一票？',
      content: '撤回后可以重新选择，之前的一票会从统计里移除。',
      confirmText: '撤回',
      success: (r) => resolve(r.confirm)
    })
  })
  if (!res || !poll.value) return

  try {
    const next = await revokeVote(poll.value.id)
    poll.value = next
    myVote.value = []
    selection.value = []
  } catch {
    uni.showToast({ title: '撤回失败', icon: 'none' })
  }
}

/* ---------- 跳转 ---------- */

function goResult() {
  go(ROUTES.detailResult, { id: pollId.value })
}

function goVoters() {
  go(ROUTES.detailVoters, { id: pollId.value })
}

function goComments() {
  go(ROUTES.detailComments, { id: pollId.value })
}

function goData() {
  go(ROUTES.creatorData, { id: pollId.value })
}

function goFill() {
  go(ROUTES.surveyFill, { id: pollId.value })
}

function goMine() {
  go(ROUTES.surveyMine, { id: pollId.value })
}

function goEditAnswer() {
  go(ROUTES.surveyEditAnswer, { id: pollId.value, answerId: myAnswer.value?.id })
}

function goAnswers() {
  go(ROUTES.surveyAnswers, { id: pollId.value })
}

/** 发起人右上角「···」：和 41 列表里的面板同一套动作 */
function openManage() {
  uni.showActionSheet({
    itemList: ['编辑', '删除'],
    success: (r) => {
      if (r.tapIndex === 0) {
        go(ROUTES.creatorEditContent, { id: pollId.value })
      } else {
        uni.showModal({
          title: `删除这${isSurvey.value ? '份问卷' : '场投票'}？`,
          content: '删除后立即从列表和分享链接下线，可在「我发起的」列表里 5 秒内撤销。',
          confirmText: '删除',
          confirmColor: '#DC2626',
          success: async (res) => {
            if (!res.confirm) return
            const { deletePoll } = await import('@/api/poll')
            await deletePoll(pollId.value)
            // 详情页可能是从首页、我发起的、我参与的、搜索结果任意一处进来的，
            // 删除后统一退回「我发起的」——那里才有撤销入口
            backTo(ROUTES.meCreated)
          }
        })
      }
    }
  })
}

onShareAppMessage(() => (poll.value ? buildShareMessage(poll.value) : { title: '投票吧', path: '/pages/index/index' }))
onShareTimeline(() => (poll.value ? buildTimelineMessage(poll.value) : { title: '投票吧' }))
</script>

<template>
  <view class="detail">
    <AppNavBar :back="true">
      <template #title>
        <text class="detail__nav-title">{{ isSurvey ? '问卷' : '投票' }}</text>
      </template>
      <template #right>
        <!-- 右上角只保留「···」管理入口；分享靠微信胶囊里的转发，不再放一个点了只会弹 toast 的假分享图标 -->
        <view v-if="isOwner" class="detail__nav-btn" @tap="openManage">
          <AppIcon name="ellipsis" :size="17" color="#09090B" />
        </view>
      </template>
    </AppNavBar>

    <view v-if="loading" class="detail__body">
      <AppSkeleton type="detail" />
    </view>

    <template v-else-if="poll">
      <scroll-view class="detail__scroll" scroll-y>
        <view class="detail__content">
          <!-- 状态行：进行中 / 你已投票 + 类型 + 匿名 + 需填信息 + 撤回 -->
          <view class="meta">
            <view class="meta__left">
              <view v-if="hasVoted" class="meta__live meta__live--voted">
                <AppIcon name="circle-check" :size="12" color="#4F46E5" :stroke-width="2" />
                <text class="meta__live-text meta__live-text--voted">你已投票</text>
              </view>
              <view v-else class="meta__live" :class="{ 'meta__live--ended': isEnded }">
                <view class="meta__dot" :class="{ 'meta__dot--ended': isEnded }" />
                <text class="meta__live-text" :class="{ 'meta__live-text--ended': isEnded }">
                  {{ liveText }}
                </text>
              </view>

              <view class="meta__chip">
                <text class="meta__chip-text">{{ isSurvey ? '问卷' : poll.type === 'multiple' ? '多选' : '单选' }}</text>
              </view>
              <view class="meta__chip">
                <text class="meta__chip-text">{{ poll.rules.anonymous ? '匿名' : '公开' }}</text>
              </view>
              <view v-if="poll.rules.profileField" class="meta__chip meta__chip--warn">
                <text class="meta__chip-text meta__chip-text--warn">需填信息</text>
              </view>
            </view>

            <view
              v-if="hasVoted && !isSurvey && poll.rules.allowEdit && !isEnded"
              class="meta__revoke"
              @tap="onRevoke"
            >
              <AppIcon name="rotate-ccw" :size="12" color="#4F46E5" :stroke-width="2" />
              <text class="meta__revoke-text">撤回</text>
            </view>
          </view>

          <text class="detail__title">{{ poll.title }}</text>
          <text v-if="poll.desc" class="detail__desc">{{ poll.desc }}</text>

          <!-- 发起人 -->
          <view class="author">
            <AppAvatar :src="poll.creatorAvatar" :name="poll.creatorName" :size="34" />
            <view class="author__info">
              <text class="author__name">
                {{ poll.creatorName }} · {{ isOwner ? '我发起的' : '发起人' }}
              </text>
              <text class="author__time">{{ metaText }}</text>
            </view>
          </view>

          <view class="detail__divider" />

          <!-- ============ 投票 ============ -->
          <template v-if="!isSurvey">
            <!-- 05/07 单选：右侧是「单选 · 未选择」；06/08 多选：换成已选数量胶囊 -->
            <view class="question">
              <text class="question__label">
                请选择 {{ poll.type === 'multiple' ? `1–${maxChoice}` : '1' }} 项
              </text>
              <view v-if="poll.type === 'multiple'" class="question__pill" :class="{ 'question__pill--on': count > 0 }">
                <text class="question__pill-text" :class="{ 'question__pill-text--on': count > 0 }">
                  已选 {{ count }}/{{ maxChoice }}
                </text>
              </view>
              <text v-else class="question__hint">
                单选 · {{ hasVoted ? '已选择' : '未选择' }}
              </text>
            </view>

            <!-- 07/08：还没投但结果可见时，先给一份实时行情 -->
            <view v-if="showStandings" class="standings">
              <view class="standings__head">
                <view class="standings__title">
                  <AppIcon name="chart-no-axes-column" :size="13" color="#4F46E5" />
                  <text class="standings__title-text">当前投票情况</text>
                </view>
                <view class="standings__count" @tap="goVoters">
                  <text class="standings__count-text">{{ poll.voterCount }} 人已投票</text>
                  <AppIcon name="chevron-right" :size="12" color="#A1A1AA" />
                </view>
              </view>

              <view class="standings__bar">
                <view
                  v-for="(s, i) in standings"
                  :key="s.id"
                  class="standings__seg"
                  :style="{ width: `${s.pct}%`, background: SEG_COLORS[Math.min(i, SEG_COLORS.length - 1)] }"
                />
              </view>

              <view class="standings__legend">
                <view class="standings__leader">
                  <view class="standings__dot" />
                  <text class="standings__leader-name">{{ standings[0]?.title }}</text>
                  <text class="standings__leader-pct">{{ standings[0]?.pct }}%</text>
                </view>
                <text v-if="leadGap > 0" class="standings__gap">领先第二名 {{ leadGap }} 个百分点</text>
              </view>
            </view>

            <view class="options" :class="optionGap">
              <OptionBar
                v-for="opt in poll.options"
                :key="opt.id"
                :title="opt.title"
                :desc="opt.desc"
                :votes="opt.votes"
                :total="totalVotes"
                :multiple="poll.type === 'multiple'"
                :selected="(hasVoted ? myVote : selection).includes(opt.id)"
                :mode="optionMode"
                :disabled="hasVoted || isEnded"
                @select="selectOption(opt.id)"
              />
            </view>

            <!-- 10/12：结果暂不可见 -->
            <view v-if="hasVoted && !canSeeResult" class="locked-note">
              <view class="locked-note__icon">
                <AppIcon name="lock" :size="15" color="#A1A1AA" />
              </view>
              <view class="locked-note__text">
                <text class="locked-note__title">结果暂不可见</text>
                <text class="locked-note__desc">发起人设置了截止后公布</text>
              </view>
              <AppIcon name="chevron-right" :size="14" color="#A1A1AA" />
            </view>

            <!-- 09/11：底部一行「剩 3 天 6 小时」 -->
            <view v-if="hasVoted" class="footer-stat">
              <text class="footer-stat__text">{{ remainingText }}</text>
            </view>

            <view v-if="hasVoted && poll.rules.allowComment" class="discuss">
              <view class="discuss__head">
                <text class="discuss__title">讨论 {{ poll.commentCount }}</text>
                <text class="discuss__all" @tap="goComments">查看全部</text>
              </view>

              <view v-for="c in previewComments" :key="c.id" class="discuss__item">
                <AppAvatar :src="c.user.avatar" :name="c.user.name" :size="28" />
                <view class="discuss__body">
                  <text class="discuss__name">{{ c.user.name }}</text>
                  <text class="discuss__text">{{ c.content }}</text>
                </view>
              </view>
            </view>

            <!-- 09/11 参与入口：头像叠层 + 人数 / 查看记录；17/18 评论关闭时它是唯一入口 -->
            <view v-if="hasVoted" class="participants" @tap="goVoters">
              <view class="participants__stack">
                <view
                  v-for="(v, i) in voterAvatars"
                  :key="v.id"
                  class="participants__avatar"
                  :class="{ 'participants__avatar--overlap': i > 0 }"
                >
                  <AppAvatar :src="v.avatar" :name="v.name" :size="28" />
                </view>
              </view>
              <view class="participants__text">
                <text class="participants__count">{{ poll.voterCount }} 人已投票</text>
                <text class="participants__sub">查看投票记录</text>
              </view>
              <AppIcon name="chevron-right" :size="16" color="#4F46E5" />
            </view>
          </template>

          <!-- ============ 问卷（已提交） ============ -->
          <template v-else>
            <view class="question">
              <text class="question__label">说说你的想法</text>
              <text class="question__hint">
                自由填写 · 已提交{{ myAnswers.length > 1 ? ` ${myAnswers.length} 次` : '' }}
              </text>
            </view>

            <view class="answer">
              <view class="answer__head">
                <text class="answer__label">我的回答</text>
                <view class="answer__badge">
                  <text class="answer__badge-text">
                    {{ myAnswers.length > 1 ? `已提交 ${myAnswers.length} 次` : canEditAnswer ? '可修改' : '已提交' }}
                  </text>
                </view>
              </view>
              <text class="answer__text">{{ myAnswer?.content }}</text>
              <view class="answer__foot">
                <text class="answer__time">
                  {{ myAnswers.length > 1 ? '最近一次 ' : '' }}{{ myAnswer ? formatRelative(myAnswer.createdAt) : '' }}
                </text>
                <text class="answer__count">{{ myAnswer ? charCount(myAnswer.content) : 0 }} 字</text>
              </view>
            </view>

            <view class="footer-stat">
              <text class="footer-stat__text">{{ remainingText }}</text>
            </view>

            <view v-if="poll.rules.allowComment" class="discuss">
              <view class="discuss__head">
                <text class="discuss__title">讨论 {{ poll.commentCount }}</text>
                <text class="discuss__all" @tap="goComments">查看全部</text>
              </view>
              <view v-for="c in previewComments" :key="c.id" class="discuss__item">
                <AppAvatar :src="c.user.avatar" :name="c.user.name" :size="28" />
                <view class="discuss__body">
                  <text class="discuss__name">{{ c.user.name }}</text>
                  <text class="discuss__text">{{ c.content }}</text>
                </view>
              </view>
            </view>

            <view class="participants" @tap="goAnswers">
              <view class="participants__stack">
                <view
                  v-for="(v, i) in voterAvatars"
                  :key="v.id"
                  class="participants__avatar"
                  :class="{ 'participants__avatar--overlap': i > 0 }"
                >
                  <AppAvatar :src="v.avatar" :name="v.name" :size="28" />
                </view>
              </view>
              <view class="participants__text">
                <text class="participants__count">{{ poll.answerCount ?? 0 }} 人已提交</text>
                <text class="participants__sub">查看回答记录</text>
              </view>
              <AppIcon name="chevron-right" :size="16" color="#4F46E5" />
            </view>
          </template>
        </view>
      </scroll-view>

      <!-- ============ 底部操作栏 ============ -->
      <view class="actions" :style="{ paddingBottom: bottomInset(20) }">
        <!-- 投票 · 未投票（19：118 宽「投票数据」+ 剩余宽「确认投票」） -->
        <template v-if="!isSurvey && !hasVoted && !isEnded">
          <view v-if="isOwner" class="actions__side">
            <AppButton type="subtle" size="action" icon="chart-no-axes-column" @tap="goData">
              投票数据
            </AppButton>
          </view>
          <view class="actions__main">
            <AppButton size="submit" :disabled="submitDisabled" :loading="submitting" @tap="onSubmit">
              {{ selection.length ? `确认投票（${selection.length}）` : '确认投票' }}
            </AppButton>
          </view>
        </template>

        <!-- 投票 · 已投票（20：118 宽「投票数据」+ 剩余宽「分享投票」） -->
        <template v-else-if="!isSurvey && hasVoted">
          <view v-if="isOwner" class="actions__side">
            <AppButton type="subtle" size="action" icon="chart-no-axes-column" @tap="goData">
              投票数据
            </AppButton>
          </view>
          <view class="actions__main">
            <AppButton size="submit" icon="share-2" open-type="share">分享投票</AppButton>
          </view>
        </template>

        <!-- 投票 · 已结束且我没投 -->
        <template v-else-if="!isSurvey && isEnded && !hasVoted">
          <view v-if="isOwner" class="actions__side">
            <AppButton type="subtle" size="action" icon="chart-no-axes-column" @tap="goData">
              投票数据
            </AppButton>
          </view>
          <view class="actions__main">
            <AppButton size="submit" :disabled="!canSeeResult" @tap="goResult">
              {{ canSeeResult ? '查看结果' : '结果已关闭' }}
            </AppButton>
          </view>
        </template>

        <!-- 问卷 · 已提交（69/70/76：并列按钮等分整行） -->
        <template v-else>
          <view v-if="isOwner" class="actions__half">
            <AppButton type="subtle" size="action" icon="chart-no-axes-column" @tap="goData">
              问卷数据
            </AppButton>
          </view>

          <template v-if="canRepeat">
            <view class="actions__half">
              <AppButton type="subtle" size="action" icon="history" @tap="goMine">我的提交</AppButton>
            </view>
            <view class="actions__half">
              <AppButton size="action" icon="plus" @tap="goFill">再提交一次</AppButton>
            </view>
          </template>

          <view v-else-if="canEditAnswer" class="actions__half">
            <AppButton size="action" icon="square-pen" @tap="goEditAnswer">修改我的回答</AppButton>
          </view>

          <view v-else class="actions__half">
            <AppButton type="subtle" size="action" icon="share-2" open-type="share">
              分享问卷
            </AppButton>
          </view>
        </template>
      </view>
    </template>

    <!-- 16 / 65：需填信息 -->
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
          <input
            v-model="infoValue"
            class="info-form__input"
            :placeholder="`请输入你的${poll?.rules.profileField}`"
            placeholder-class="info-form__ph"
          />
          <text class="info-form__hint">产品部 / 工号 1024</text>
        </view>
      </view>

      <template #footer>
        <view class="info-form__ok">
          <AppButton
            size="compact"
            :disabled="!infoValue.trim()"
            :loading="submitting"
            @tap="doVote"
          >
            确认并提交
          </AppButton>
        </view>
      </template>
    </AppSheet>
  </view>
</template>

<script lang="ts">
export default { name: 'PollDetailPage' }
</script>

<style lang="scss" scoped>
.detail {
  min-height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  &__nav-title {
    font-size: 16px;
    font-weight: 600;
    color: $ink;
  }

  &__nav-btn {
    width: 34px;
    height: 34px;
    border-radius: 17px;
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

  /* 设计稿 05~20 的 Content：竖向流、padding [8,20,20,20]；底部操作栏自处理安全区 */
  &__content {
    padding: 8px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: $section-gap;
  }

  &__title {
    font-size: 26px;
    font-weight: 700;
    color: $ink;
    line-height: 1.35;
  }

  &__desc {
    font-size: 13px;
    color: $muted;
    line-height: 1.6;
  }

  &__divider {
    height: 1px;
    background: $line;
  }
}

/* 状态行：左组靠左、撤回靠右 */
.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;

  &__left {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-width: 0;
  }

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

    /* 09：已投票用 $accent-soft + circle-check 图标，不再是「进行中」的绿点 */
    &--voted {
      background: $accent-soft;
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

    &--voted {
      color: $accent;
    }
  }

  /* 设计稿 Chip 单选 / 匿名：$subtle、padding [5,8]、圆角 6、字 11 */
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

  /* 09：撤回是「图标 + 紫字」，不是描边按钮 */
  &__revoke {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  &__revoke-text {
    font-size: 12px;
    font-weight: 600;
    color: $accent;
  }
}

/* 发起人 */
.author {
  display: flex;
  align-items: center;
  gap: 10px;

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

/* 问题行 */
/* 问题行：左标题、右提示或「已选 N/3」胶囊 */
.question {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  &__label {
    font-size: 13px;
    font-weight: 600;
    color: $ink;
  }

  &__hint {
    font-size: 12px;
    color: $faint;
  }

  /* 06/08：多选的已选数量胶囊，圆角 10、内边距 [4,10] */
  &__pill {
    padding: 4px 10px;
    border-radius: 10px;
    background: $subtle;

    &--on {
      background: $accent-soft;
    }
  }

  &__pill-text {
    font-size: 11px;
    font-weight: 600;
    color: $faint;

    &--on {
      color: $accent;
    }
  }
}

/* 07/08 实时行情：白卡、圆角 16、内边距 14、行距 10 */
.standings {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: $surface;
  border: 1px solid $line;
  border-radius: 16px;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  &__title {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  &__title-text {
    font-size: 13px;
    font-weight: 600;
    color: $ink;
  }

  &__count {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  &__count-text {
    font-size: 11px;
    color: $muted;
  }

  /* 8 高分段条，段与段之间 2 的缝 */
  &__bar {
    display: flex;
    gap: 2px;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
  }

  &__seg {
    height: 100%;
    border-radius: 4px;
    min-width: 4px;
  }

  &__legend {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  &__leader {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }

  &__dot {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: $accent;
    flex-shrink: 0;
  }

  &__leader-name {
    font-size: 11px;
    font-weight: 600;
    color: $ink;
  }

  &__leader-pct {
    font-size: 11px;
    font-weight: 600;
    color: $accent;
  }

  &__gap {
    font-size: 10px;
    color: $faint;
    flex-shrink: 0;
  }
}

/* 选项列表：待投票 10 的行距；结果可见（09/11）12；结果隐藏（10/12）8 */
.options {
  display: flex;
  flex-direction: column;
  gap: 10px;

  &--result {
    gap: 12px;
  }

  &--tight {
    gap: 8px;
  }
}

/* 10/12 结果暂不可见：$subtle 卡、圆角 14、内边距 14、左侧 30 白色圆形图标底 */
.locked-note {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  background: $subtle;
  border-radius: 14px;

  &__icon {
    width: 30px;
    height: 30px;
    border-radius: 15px;
    background: $surface;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__title {
    font-size: 13px;
    font-weight: 500;
    color: $ink;
  }

  &__desc {
    font-size: 11px;
    color: $faint;
  }
}

/* 09/11 底部一行辅助信息：11 / $faint */
.footer-stat {
  display: flex;
  align-items: center;

  &__text {
    font-size: 11px;
    color: $faint;
  }
}

/* 讨论区预览（09 Comments Preview）：白卡、圆角 16、内边距 16 */
.discuss {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: $surface;
  border: 1px solid $line;
  border-radius: 16px;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    font-size: 14px;
    font-weight: 700;
    color: $ink;
  }

  &__all {
    font-size: 11px;
    color: $accent;
  }

  &__item {
    display: flex;
    gap: 10px;
  }

  &__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__name {
    font-size: 11px;
    font-weight: 600;
    color: $ink;
  }

  &__text {
    font-size: 12px;
    color: $muted;
    line-height: 1.5;
  }
}

/* 参与入口（09/11 Participants Entry）：白卡 12 圆角、头像叠层、计数 $accent */
.participants {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  background: $surface;
  border: 1px solid $line;
  border-radius: 12px;

  &__stack {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  /* 每个头像 2px 白描边，后一个压住前一个 8 */
  &__avatar {
    border-radius: 50%;
    border: 2px solid $surface;

    &--overlap {
      margin-left: -8px;
    }
  }

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  &__count {
    font-size: 13px;
    font-weight: 600;
    color: $accent;
  }

  &__sub {
    font-size: 11px;
    color: $faint;
  }
}

/* 问卷：我的回答卡 */
/* 问卷 67：我的回答卡，圆角 16、内边距 16、行距 10 */
.answer {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: $surface;
  border: 1px solid $line;
  border-radius: 16px;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  /* 「我的回答」是弱标题，11 / 600 / $faint */
  &__label {
    font-size: 11px;
    font-weight: 600;
    color: $faint;
  }

  /* 状态是 $subtle 小胶囊：圆角 6、内边距 [3,8]、10 / 600 / $muted */
  &__badge {
    padding: 3px 8px;
    border-radius: 6px;
    background: $subtle;
  }

  &__badge-text {
    font-size: 10px;
    font-weight: 600;
    color: $muted;
  }

  &__text {
    font-size: 14px;
    color: $ink;
    line-height: 1.6;
  }

  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  &__time,
  &__count {
    font-size: 11px;
    color: $faint;
  }
}

/* 底部操作栏：设计稿 padding [12,20,20,20]，没有额外底色 —— 与页面同为 $bg；
   下边距用 bottomInset() 内联控制（20 + 底部小横条高度） */
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px $gutter 0;
  background: $bg;
  flex-shrink: 0;

  /* 19/20 的「投票数据」是 118 宽的固定宽度次按钮。
     宽度给外层 view，不能给 AppButton —— 自定义组件的根节点是宿主，
     样式虽然能落到宿主上，但内部 .btn 是 inline-flex，会收缩到内容宽度。 */
  &__side {
    flex: 0 0 118px;
    width: 118px;
  }

  &__main {
    flex: 1;
    min-width: 0;
  }

  /* 69/70/76：并列按钮等分整行（设计稿是 fill_container） */
  &__half {
    flex: 1;
    min-width: 0;
  }
}

/* 需填信息表单（16/65）：字段间距 14，标签 12/500/$muted，输入框 44 高 */
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
    font-size: 12px;
    font-weight: 500;
    color: $muted;
  }

  &__input {
    height: 44px;
    padding: 0 14px;
    border-radius: 12px;
    background: $surface;
    border: 1px solid $line;
    font-size: 14px;
    color: $ink;
  }

  &__ph,
  &__hint {
    color: $faint;
  }

  &__hint {
    font-size: 10px;
  }

  &__ok {
    width: 100%;
  }
}
</style>
