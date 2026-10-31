<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onLoad, onShow, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app'
import type { Poll, Comment, Paged, SurveyAnswer, VoterRecord } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppAvatar from '@/components/base/AppAvatar.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSheet from '@/components/base/AppSheet.vue'
import AppActionSheet from '@/components/base/AppActionSheet.vue'
import AppConfirmSheet from '@/components/base/AppConfirmSheet.vue'
import AppInviteCode from '@/components/base/AppInviteCode.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import OptionBar from '@/components/business/OptionBar.vue'
import {
  fetchPoll,
  fetchMyVote,
  votePoll,
  revokeVote,
  fetchComments,
  fetchMyAnswers,
  fetchAnswers,
  fetchVoters,
  joinPoll,
  deletePoll,
  endPoll
} from '@/api/poll'
import { useUserStore } from '@/stores/user'
import { ApiError } from '@/utils/request'
import { formatCreatedAt, formatRemaining, formatRelative, charCount, percent } from '@/utils/format'
import { buildShareMessage, buildTimelineMessage, syncShareMenu } from '@/utils/share'
import { canSeePollResult } from '@/utils/result-visibility'
import { useInviteCode } from '@/utils/invite'
import { bottomInset } from '@/utils/platform'
import { backTo, go, replace, switchTab, ROUTES } from '@/utils/router'
import { cacheGet, cacheSet, cacheDrop, cacheKey } from '@/utils/cache'
import { setPendingUndo } from '@/utils/delete-undo'
import AppToast from '@/components/base/AppToast.vue'
import { toast } from '@/utils/toast'

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
/** 邀请码模式的投票：被 403 拦下时弹自定义输入层 */
const invite = useInviteCode()

/**
 * 详情页可以公开预览，但邀请制投票的评论、以及「我还没提交过」的问卷回答
 * 服务端会返回 403。这种情况按「暂时看不到」处理，不要让整页掉进错误态。
 */
function ignoreForbidden<T>(task: Promise<T>, fallback: T): Promise<T> {
  return task.catch((err) => {
    if (err instanceof ApiError && err.code === 403) return fallback
    throw err
  })
}

const poll = ref<Poll | null>(null)
const myVote = ref<string[]>([])
const myAnswers = ref<SurveyAnswer[]>([])
/** 75 发起人 · 我的问卷：还没答时展示最新回答，而不是一张空的「我的回答」卡 */
const latestAnswers = ref<SurveyAnswer[]>([])
const comments = ref<Comment[]>([])
const loading = ref(true)
const loadError = ref(false)
/** 404：链接里的 id 不存在，和「已删除」分开提示 */
const notFound = ref(false)
/** 路由参数缺失，页面没东西可加载，不能一直停在骨架屏 */
const invalid = ref(false)
/** 410：投票已被发起人删除，展示专门的空状态而不是「加载失败」 */
const deleted = ref(false)
const submitting = ref(false)
const selection = ref<string[]>([])

/** 16 / 65：需填信息弹层 */
const infoVisible = ref(false)
const infoValue = ref('')

/** 撤回 / 提前结束 / 删除的二次确认 */
const revokeVisible = ref(false)
const endVisible = ref(false)
const deleteVisible = ref(false)
const revoking = ref(false)
const ending = ref(false)
const deleting = ref(false)

/** 发起人「···」管理菜单 */
const manageVisible = ref(false)
const manageItems = computed(() => {
  const noun = isSurvey.value ? '问卷' : '投票'
  return [
    { key: 'edit', label: `编辑${noun}`, icon: 'square-pen' },
    ...(isEnded.value ? [] : [{ key: 'end', label: '提前结束', icon: 'circle-check' }]),
    { key: 'delete', label: `删除${noun}`, icon: 'trash-2', danger: true }
  ]
})

const pollId = ref('')

const isOwner = computed(() => !!poll.value && poll.value.creatorId === user.profile?.id)
const isSurvey = computed(() => poll.value?.type === 'survey')
const isEnded = computed(() => !!poll.value && poll.value.rules.endAt <= Date.now())
const hasVoted = computed(() => (isSurvey.value ? myAnswers.value.length > 0 : myVote.value.length > 0))

/** 结果能不能看见：发起人永远能看见；参与者看 resultVisibility */
const canSeeResult = computed(() => {
  const p = poll.value
  if (!p) return false
  return canSeePollResult(p, { isOwner: isOwner.value, hasVoted: hasVoted.value, isEnded: isEnded.value })
})

/** 发起人关掉「查看投票人数」后，其他人看不到任何人数（后端也会把 voterCount 置 0） */
const showVoterCount = computed(() => !poll.value?.rules.hideVoterCount || isOwner.value)

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

/**
 * 09/11 讨论区只露两条；只取顶层评论，回复不算一条独立讨论。
 *
 * 万一一屏里全是回复（父评论被删了），退回用回复本身，至少卡片不会是空的。
 */
const previewComments = computed(() => {
  const roots = comments.value.filter((c) => !c.replyToId)
  return (roots.length ? roots : comments.value).slice(0, 2)
})

/**
 * 一条评论都没有时，讨论入口那一行的摘要。
 *
 * 这里不能空着 —— 入口本身要一直在（发起人开了评论就该能进去），
 * 空卡片的观感又差，所以换成一句邀请。
 */
const discussPreview = computed(() => {
  const c = previewComments.value[0]
  if (!c) return '还没有人发言，来说第一句'
  return c.user?.name ? `${c.user.name}：${c.content}` : c.content
})

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

/**
 * 详情页整屏快照
 *
 * 只缓存 poll 是不够的：myVote 是空的，页面会先按「还没投票」渲染，
 * 一秒后再跳成「已投票」，选项从可点变只读 —— 比骨架屏还晃眼。
 * 所以把这一屏依赖的数据打包存，进来时一次性恢复。
 */
interface DetailSnapshot {
  poll: Poll
  myVote: string[]
  myAnswers: SurveyAnswer[]
  latestAnswers: SurveyAnswer[]
  comments: Comment[]
  voterAvatars: Array<{ id: string; name: string; avatar?: string }>
}

function snapshotOf(p: Poll): DetailSnapshot {
  return {
    poll: p,
    myVote: [...myVote.value],
    myAnswers: [...myAnswers.value],
    latestAnswers: [...latestAnswers.value],
    comments: [...comments.value],
    voterAvatars: [...voterAvatars.value]
  }
}

function saveSnapshot(p: Poll) {
  cacheSet(cacheKey.pollDetail(p.id), snapshotOf(p))
}

function applySnapshot(s: DetailSnapshot) {
  poll.value = s.poll
  myVote.value = [...s.myVote]
  myAnswers.value = [...s.myAnswers]
  latestAnswers.value = [...s.latestAnswers]
  comments.value = [...s.comments]
  voterAvatars.value = [...s.voterAvatars]
  // 没提交过的勾选要保留：从讨论区退回来不能把用户选了一半的选项清掉
  if (!selection.value.length) selection.value = [...s.myVote]
}

async function load() {
  // 有快照就先渲染，再静默拉最新：骨架屏只在真的没数据时出现
  if (!poll.value) {
    const cached = cacheGet<DetailSnapshot>(cacheKey.pollDetail(pollId.value))
    if (cached) applySnapshot(cached)
  }
  loading.value = !poll.value
  loadError.value = false
  notFound.value = false
  deleted.value = false
  try {
    const p = await fetchPoll(pollId.value)
    poll.value = p
    syncShareMenu(p.rules.allowShare)

    // 问卷且我还没答过、也不是发起人 → 直接去填写页，避免出现一个空壳详情
    if (p.type === 'survey') {
      const answers = await fetchMyAnswers(p.id)
      myAnswers.value = answers
      if (!answers.length && p.creatorId !== user.profile?.id && p.rules.endAt > Date.now()) {
        replace(ROUTES.surveyFill, { id: p.id })
        return
      }

      // 75：发起人自己还没填时，详情页要能看到「最新回答」，不是空的我的回答
      const page = await ignoreForbidden<Paged<SurveyAnswer>>(
        fetchAnswers(p.id, null, { toast: false }),
        { list: [], cursor: null, hasMore: false, total: 0 }
      )
      latestAnswers.value = page.list.slice(0, 3)

      // 同一个人重复提交时头像只留一张，否则「林 林 林 周」看着像来了四个人
      const seen = new Set<string>()
      const avatars: Array<{ id: string; name: string; avatar?: string }> = []
      page.list.forEach((a, i) => {
        const u = a.user ?? { id: `anon${i}`, name: '匿' }
        if (seen.has(u.id) || avatars.length >= 4) return
        seen.add(u.id)
        avatars.push(u)
      })
      voterAvatars.value = avatars
    } else {
      myVote.value = await fetchMyVote(p.id)
      // 从别的页面退回来时不清空用户已经点选但还没提交的选择 ——
      // 否则去评论区看一眼再回来，选项全没了
      if (!selection.value.length) selection.value = [...myVote.value]
    }

    if (p.rules.allowComment) {
      const page = await ignoreForbidden<Paged<Comment>>(
        fetchComments(p.id, { toast: false }),
        { list: [], cursor: null, hasMore: false, total: 0 }
      )
      comments.value = page.list
    }

    // 参与入口的头像叠层：投票取投票人；问卷在上面已经按回答人取过了。
    // 结果不可见时服务端会 403，没必要为了几个头像打断整页加载。
    if (p.type !== 'survey' && canSeeResult.value) {
      const voters = await ignoreForbidden<Paged<VoterRecord>>(
        fetchVoters(p.id, null, { toast: false }),
        { list: [], cursor: null, hasMore: false, total: 0 }
      )
      voterAvatars.value = voters.list.slice(0, 4).map((v, i) => v.user ?? { id: `anon${i}`, name: '匿' })
    }

    // 字段都齐了再存：下次进来才能一次恢复完整状态
    saveSnapshot(p)
  } catch (err) {
    // 410：发起人删除了投票；404：链接里的 id 根本不存在。
    // 两种情况都不能再显示缓存里的那份，否则页面看起来「还活着」。
    if (err instanceof ApiError && (err.code === 404 || err.code === 410)) {
      cacheDrop(cacheKey.pollAll(pollId.value))
      cacheDrop('list:mine')
      poll.value = null
      if (err.code === 404) notFound.value = true
      else deleted.value = true
    } else if (!poll.value) {
      // 其余失败（比如断网）静默处理：有快照就保持上一次的内容，比换成错误页好
      loadError.value = true
    }
  } finally {
    loading.value = false
  }
}

onLoad((query) => {
  pollId.value = (query?.id as string) ?? ''
})

onMounted(() => {
  if (!pollId.value) {
    invalid.value = true
    loading.value = false
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
  else toast.show(`最多选 ${maxChoice.value} 项`)
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
  const p = poll.value
  if (!p) return
  submitting.value = true
  try {
    // 邀请码模式的投票：第一次被 403 拦下时收一次码，加入后重试一次
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const next = await votePoll(
          p.id,
          selection.value,
          infoValue.value.trim() || undefined,
          { toast: false }
        )
        poll.value = next
        myVote.value = [...selection.value]
        // 票数变了，快照要跟着更新，否则再进详情会先闪一下投票前的数字
        saveSnapshot(next)
        infoVisible.value = false
        go(ROUTES.detailSuccess, { id: p.id })
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
    const msg = (err as Error)?.message || '投票失败，请重试'
    toast.error(msg)
  } finally {
    submitting.value = false
  }
}

/** 09/11 的「撤回」：仅「允许修改选择」且未截止时出现 */
function onRevoke() {
  revokeVisible.value = true
}

async function doRevoke() {
  if (!poll.value) return
  revokeVisible.value = false
  revoking.value = true
  try {
    const next = await revokeVote(poll.value.id)
    poll.value = next
    myVote.value = []
    selection.value = []
    saveSnapshot(next)
  } catch {
    // 失败原因由请求层统一 toast，这里不再重复
  } finally {
    revoking.value = false
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

/** 27/80 分享页：海报 + 微信/朋友圈/更多 */
function goShare() {
  go(ROUTES.share, { id: pollId.value })
}


/** 发起人右上角「···」：和 41 列表里的面板同一套动作 */
function openManage() {
  manageVisible.value = true
}

function onManage(key: string) {
  if (key === 'edit') go(ROUTES.creatorEditContent, { id: pollId.value })
  else if (key === 'end') confirmEnd()
  else confirmDelete()
}

function confirmEnd() {
  endVisible.value = true
}

async function doEnd() {
  endVisible.value = false
  ending.value = true
  try {
    await endPoll(pollId.value)
    cacheDrop(cacheKey.pollAll(pollId.value))
    cacheDrop('list:mine')
    // 结束会改状态、票数可见性和通知，直接重拉一次让页面进入只读态
    await load()
  } catch {
    // 接口层已经弹过提示，这里只负责别让 async 回调抛出未处理的 rejection
  } finally {
    ending.value = false
  }
}

const deleteDesc = computed(() => {
  const p = poll.value
  if (!p) return ''
  const participants = isSurvey.value ? (p.answerCount ?? 0) : (p.voterCount ?? 0)
  const unit = isSurvey.value ? '条回答' : '人参与'
  const base = '删除后立即从列表和分享链接下线，参与者再打开会看到「已被删除」；可在「我发起的」列表里 5 秒内撤销。'
  return participants > 0 ? `已有 ${participants} ${unit}，${base}` : base
})

function confirmDelete() {
  deleteVisible.value = true
}

async function doDelete() {
  const p = poll.value
  deleteVisible.value = false
  deleting.value = true
  try {
    await deletePoll(pollId.value)
    // 删掉的投票不该再出现在任何缓存里
    cacheDrop(cacheKey.pollAll(pollId.value))
    cacheDrop('list:mine')
    // 撤销条长在「我发起的」页面里，跨页把刚删掉的投票交过去
    if (p) setPendingUndo(p)
    // 详情页可能是从首页、我发起的、我参与的、搜索结果任意一处进来的，
    // 删除后统一退回「我发起的」——那里才有撤销入口
    backTo(ROUTES.meCreated)
  } catch {
    // 接口层已经弹过提示
  } finally {
    deleting.value = false
  }
}

function goHome() {
  switchTab(ROUTES.home)
}

onShareAppMessage(() => (poll.value ? buildShareMessage(poll.value) : { title: '杜雅轩', path: '/pages/index/index' }))
onShareTimeline(() => (poll.value ? buildTimelineMessage(poll.value) : { title: '杜雅轩' }))
</script>

<template>
  <view class="detail">
    <AppToast />
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

    <AppEmpty
      v-else-if="invalid"
      icon="triangle-alert"
      title="打开方式不对"
      desc="链接里缺少投票编号，请从分享卡片或消息里重新打开"
      action="返回首页"
      action-icon="arrow-left"
      @action="goHome"
    />

    <AppEmpty
      v-else-if="notFound"
      icon="search"
      title="没有找到这个投票"
      desc="链接可能有误，或者投票已经不存在了"
      action="返回首页"
      action-icon="arrow-left"
      @action="goHome"
    />

    <AppEmpty
      v-else-if="loadError"
      icon="wifi-off"
      title="加载失败"
      desc="网络不太稳定，重试一下就好"
      action="重新加载"
      action-icon="refresh-cw"
      @action="load"
    />

    <!-- 发起人删除后，别人手里的链接仍然打得开，但只剩这个墓碑 -->
    <AppEmpty
      v-else-if="deleted"
      icon="trash-2"
      title="该投票已被发起人删除"
      desc="链接已经失效，去首页看看别的投票吧"
      action="返回首页"
      action-icon="arrow-left"
      @action="goHome"
    />

    <template v-else-if="poll">
      <scroll-view class="detail__scroll" scroll-y>
        <view class="detail__content">
          <!-- 状态行：进行中 / 你已投票 + 类型 + 匿名 + 需填信息 + 撤回 -->
          <view class="meta">
            <view class="meta__left">
              <view v-if="hasVoted" class="meta__live meta__live--voted">
                <AppIcon name="circle-check" :size="12" color="#4F46E5" :stroke-width="2" />
                <text class="meta__live-text meta__live-text--voted">
                  {{ isSurvey ? '你已提交' : '你已投票' }}
                </text>
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
              <view v-if="poll.updatedAt" class="meta__chip meta__chip--edit">
                <text class="meta__chip-text meta__chip-text--edit">已编辑</text>
              </view>
            </view>

            <view
              v-if="hasVoted && !isSurvey && !isOwner && poll.rules.allowEdit && !isEnded"
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
            <AppAvatar
              :src="poll.creatorAvatar"
              :name="poll.creatorName"
              :seed="poll.creatorId"
              :size="34"
            />
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
                <view v-if="showVoterCount" class="standings__count" @tap="goVoters">
                  <text class="standings__count-text">{{ poll.voterCount }} 人已投票</text>
                  <AppIcon name="chevron-right" :size="12" color="#A1A1AA" />
                </view>
              </view>

              <!-- 空轨道是底色，票数段叠在上面；0 票时没有段，只剩一条灰条 -->
              <view class="standings__bar">
                <template v-for="(s, i) in standings" :key="s.id">
                  <!-- 0 票的选项不画：min-width 会让它变成一颗 4px 的色块 -->
                  <view
                    v-if="s.pct > 0"
                    class="standings__seg"
                    :style="{ width: `${s.pct}%`, background: SEG_COLORS[Math.min(i, SEG_COLORS.length - 1)] }"
                  />
                </template>
              </view>

              <view class="standings__legend">
                <template v-if="totalVotes > 0">
                  <view class="standings__leader">
                    <view class="standings__dot" />
                    <text class="standings__leader-name">{{ standings[0]?.title }}</text>
                    <text class="standings__leader-pct">{{ standings[0]?.pct }}%</text>
                  </view>
                  <text v-if="leadGap > 0" class="standings__gap">领先第二名 {{ leadGap }} 个百分点</text>
                </template>
                <!-- 一票都没有时，「领先 0%」没有意义，换成一句引导 -->
                <text v-else class="standings__hint">还没有人投票，来投出第一票</text>
              </view>
            </view>

            <view class="options" :class="optionGap">
              <OptionBar
                v-for="opt in poll.options"
                :key="opt.id"
                :title="opt.title"
                :desc="opt.desc"
                :images="opt.images"
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

            <!--
              讨论区入口：投票前后都要在。
              以前只在 hasVoted 之后才出现，还没投票的人根本进不去讨论区，
              发起人开了「允许评论」也等于没有。有评论就摆预览卡，一条都没有摆紧凑入口。
            -->
            <view v-if="poll.rules.allowComment && poll.commentCount > 0" class="discuss">
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

            <view v-else-if="poll.rules.allowComment" class="discuss-entry" @tap="goComments">
              <view class="discuss-entry__icon">
                <AppIcon name="message-square" :size="15" color="#4F46E5" />
              </view>
              <view class="discuss-entry__text">
                <text class="discuss-entry__title">讨论区</text>
                <text class="discuss-entry__desc">{{ discussPreview }}</text>
              </view>
              <AppIcon name="chevron-right" :size="15" color="#A1A1AA" />
            </view>

            <!-- 09/11 参与入口：头像叠层 + 人数 / 查看记录；17/18 评论关闭时它是唯一入口 -->
            <view v-if="hasVoted && canSeeResult" class="participants" @tap="goVoters">
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
                <text v-if="showVoterCount" class="participants__count">
                  {{ poll.voterCount }} 人已投票
                </text>
                <text class="participants__sub">查看投票记录</text>
              </view>
              <AppIcon name="chevron-right" :size="16" color="#4F46E5" />
            </view>
          </template>

          <!-- ============ 问卷（未提交 / 已提交） ============ -->
          <template v-else>
            <view class="question">
              <text class="question__label">说说你的想法</text>
              <text class="question__hint">
                <template v-if="hasVoted">
                  自由填写 · 已提交{{ myAnswers.length > 1 ? ` ${myAnswers.length} 次` : '' }}
                </template>
                <template v-else>自由填写</template>
              </text>
            </view>

            <!-- 75 发起人还没填：先看最新回答，而不是一张空的「我的回答」 -->
            <view v-if="isOwner && !hasVoted" class="latest">
              <view class="latest__head">
                <text class="latest__title">最新回答</text>
                <text class="latest__sub">共 {{ poll.answerCount ?? 0 }} 条</text>
              </view>

              <view v-for="a in latestAnswers" :key="a.id" class="latest__item">
                <AppAvatar :src="a.user?.avatar" :name="a.user?.name ?? '匿'" :size="32" />
                <view class="latest__body">
                  <view class="latest__top">
                    <text class="latest__name">{{ a.user?.name ?? `#${a.id}` }}</text>
                    <text class="latest__time">{{ formatRelative(a.createdAt) }}</text>
                  </view>
                  <text class="latest__text">{{ a.content || '（跳过未答）' }}</text>
                </view>
              </view>

              <view v-if="!latestAnswers.length" class="latest__empty">还没有人回答</view>

              <view v-if="latestAnswers.length" class="latest__more" @tap="goAnswers">
                <text class="latest__more-text">查看全部 {{ poll.answerCount ?? 0 }} 条回答</text>
              </view>
            </view>

            <view v-else class="answer">
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

            <!-- 75 未提交时没有这一行：卡里已经是别人的回答，再补一句「剩 3 天」反而抢戏 -->
            <view v-if="hasVoted" class="footer-stat">
              <text class="footer-stat__text">{{ remainingText }}</text>
            </view>

            <!-- 一条评论都没有时不摆空卡：只剩「讨论 0 / 查看全部」两行字，像没加载出来 -->
            <view v-if="poll.rules.allowComment && poll.commentCount > 0" class="discuss">
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

            <!-- 问卷同样：没评论时也要留一个能进去的入口 -->
            <view v-else-if="poll.rules.allowComment" class="discuss-entry" @tap="goComments">
              <view class="discuss-entry__icon">
                <AppIcon name="message-square" :size="15" color="#4F46E5" />
              </view>
              <view class="discuss-entry__text">
                <text class="discuss-entry__title">讨论区</text>
                <text class="discuss-entry__desc">{{ discussPreview }}</text>
              </view>
              <AppIcon name="chevron-right" :size="15" color="#A1A1AA" />
            </view>

            <!-- 回答记录只对发起人和已提交过的人开放，没参与的人不摆这个入口 -->
            <view v-if="isOwner || hasVoted" class="participants" @tap="goAnswers">
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
            <!-- 发起人关掉分享后，这一格改成「查看结果」，不留一个点不动的空按钮 -->
            <AppButton v-if="poll.rules.allowShare" size="submit" icon="share-2" @tap="goShare">
              分享投票
            </AppButton>
            <AppButton v-else size="submit" :disabled="!canSeeResult" @tap="goResult">
              {{ canSeeResult ? '查看结果' : '结果已关闭' }}
            </AppButton>
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

        <!-- 问卷 · 未提交（75：发起人也要能直接去填写）/ 已提交（69/70/76） -->
        <template v-else>
          <view v-if="isOwner" class="actions__half">
            <AppButton type="subtle" size="action" icon="chart-no-axes-column" @tap="goData">
              问卷数据
            </AppButton>
          </view>

          <view v-if="!hasVoted" class="actions__half">
            <AppButton size="action" icon="square-pen" :disabled="isEnded" @tap="goFill">
              {{ isEnded ? '问卷已截止' : '提交回答' }}
            </AppButton>
          </view>

          <template v-else-if="canRepeat">
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
            <AppButton v-if="poll.rules.allowShare" type="subtle" size="action" icon="share-2" @tap="goShare">
              分享问卷
            </AppButton>
            <AppButton v-else type="subtle" size="action" icon="history" @tap="goMine">
              我的提交
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
          <text class="info-form__hint">例如：张三 / 138****0000</text>
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

    <!-- 发起人管理菜单：和 89 同一套自定义底部弹层，不再用系统 ActionSheet -->
    <AppActionSheet
      :visible="manageVisible"
      :title="`管理${isSurvey ? '问卷' : '投票'}`"
      :items="manageItems"
      @close="manageVisible = false"
      @select="onManage"
    />

    <AppConfirmSheet
      :visible="revokeVisible"
      title="撤回这一票？"
      desc="撤回后可以重新选择，之前的一票会从统计里移除。"
      confirm-text="撤回"
      :loading="revoking"
      @close="revokeVisible = false"
      @confirm="doRevoke"
    />

    <AppConfirmSheet
      :visible="endVisible"
      :title="`提前结束这${isSurvey ? '份' : '场'}${isSurvey ? '问卷' : '投票'}？`"
      desc="结束后不能再提交，结果会立即公布；规则和选项也会锁定，只能修改主题和说明。此操作不可撤销。"
      confirm-text="结束"
      :loading="ending"
      @close="endVisible = false"
      @confirm="doEnd"
    />

    <AppConfirmSheet
      :visible="deleteVisible"
      :title="`删除这${isSurvey ? '份问卷' : '场投票'}？`"
      :desc="deleteDesc"
      confirm-text="删除"
      danger
      :loading="deleting"
      @close="deleteVisible = false"
      @confirm="doDelete"
    />

    <!-- 邀请码模式的投票：和全站弹层同一套骨架，不再用原生 showModal -->
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
export default { name: 'PollDetailPage' }
</script>

<style lang="scss" scoped>
.detail {
  /* 定高：scroll-view 需要父级有确定高度，min-height 在真机上会让它塌成 0 高 */
  height: 100vh;
  /* #ifdef H5 */
  height: 100dvh;
  /* #endif */
  background: $bg;
  display: flex;
  flex-direction: column;

  &__nav-title {
    font-size: $fs-16;
    font-weight: 600;
    color: $ink;
  }

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

  /* 设计稿 05~20 的 Content：竖向流、padding [8,20,20,20]；底部操作栏自处理安全区 */
  &__content {
    padding: 8px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: $section-gap;
  }

  &__title {
    font-size: $fs-26;
    font-weight: 700;
    color: $ink;
    line-height: 1.35;
  }

  &__desc {
    font-size: $fs-13;
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
    border-radius: $r-chip;
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
    font-size: $fs-11;
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
    border-radius: $r-xs;
    background: $subtle;
    display: flex;
    align-items: center;

    &--warn {
      background: $warning-soft;
    }

    /* 「已编辑」：紫底紫字，和匿名/类型这些中性 chip 区分开 */
    &--edit {
      background: $accent-soft;
    }
  }

  &__chip-text {
    font-size: $fs-11;
    color: $muted;

    &--warn {
      color: $warning;
      font-weight: 600;
    }

    &--edit {
      color: $accent;
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
    font-size: $fs-12;
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
    font-size: $fs-12;
    font-weight: 600;
    color: $ink;
  }

  &__time {
    font-size: $fs-11;
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
    font-size: $fs-13;
    font-weight: 600;
    color: $ink;
  }

  &__hint {
    font-size: $fs-12;
    color: $faint;
  }

  /* 06/08：多选的已选数量胶囊，圆角 10、内边距 [4,10] */
  &__pill {
    padding: 4px 10px;
    border-radius: $r-sm;
    background: $subtle;

    &--on {
      background: $accent-soft;
    }
  }

  &__pill-text {
    font-size: $fs-11;
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
  border-radius: $r-button;

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
    font-size: $fs-13;
    font-weight: 600;
    color: $ink;
  }

  &__count {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  &__count-text {
    font-size: $fs-11;
    color: $muted;
  }

  /* 8 高分段条，段与段之间 2 的缝；底色是空轨道，0 票时它就是一条灰条 */
  &__bar {
    display: flex;
    gap: 2px;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    background: $subtle;
  }

  &__seg {
    height: 100%;
    border-radius: 4px;
    /* 1% 的段也要看得见，但不能为 0 票的段占位（模板里已经过滤掉了） */
    min-width: 4px;
  }

  &__hint {
    font-size: $fs-11;
    color: $faint;
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
    font-size: $fs-11;
    font-weight: 600;
    color: $ink;
  }

  &__leader-pct {
    font-size: $fs-11;
    font-weight: 600;
    color: $accent;
  }

  &__gap {
    font-size: $fs-10;
    color: $faint;
    flex-shrink: 0;
  }
}

/* 选项列表：待投票 10 的行距；结果可见（09/11）12；结果隐藏（10/12）8 */
.options {
  /* 卡片等高由 OptionBar 自己的固定高度保证；
     这里不能用 grid-auto-rows: 1fr —— 那张卡展开时会把它顶高，整组跟着变高。 */
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
  border-radius: $r-input;

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
    font-size: $fs-13;
    font-weight: 500;
    color: $ink;
  }

  &__desc {
    font-size: $fs-11;
    color: $faint;
  }
}

/* 09/11 底部一行辅助信息：11 / $faint */
.footer-stat {
  display: flex;
  align-items: center;

  &__text {
    font-size: $fs-11;
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
  border-radius: $r-button;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    font-size: $fs-14;
    font-weight: 700;
    color: $ink;
  }

  &__all {
    font-size: $fs-11;
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
    font-size: $fs-11;
    font-weight: 600;
    color: $ink;
  }

  &__text {
    font-size: $fs-12;
    color: $muted;
    line-height: 1.5;
    /* 预览只露两行：500 字的长评论不能把详情卡撑开，全文去讨论区看 */
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    word-break: break-word;
  }
}

/* 讨论入口（还没有评论时）：$subtle 底、无描边，比下面的参与卡轻一档 */
.discuss-entry {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  background: $subtle;
  border-radius: $r-input;

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
    font-size: $fs-13;
    font-weight: 500;
    color: $ink;
  }

  &__desc {
    font-size: $fs-11;
    color: $faint;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
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
  border-radius: $r-md;

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
    font-size: $fs-13;
    font-weight: 600;
    color: $accent;
  }

  &__sub {
    font-size: $fs-11;
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
  border-radius: $r-button;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  /* 「我的回答」是弱标题，11 / 600 / $faint */
  &__label {
    font-size: $fs-11;
    font-weight: 600;
    color: $faint;
  }

  /* 状态是 $subtle 小胶囊：圆角 6、内边距 [3,8]、10 / 600 / $muted */
  &__badge {
    padding: 3px 8px;
    border-radius: $r-xs;
    background: $subtle;
  }

  &__badge-text {
    font-size: $fs-10;
    font-weight: 600;
    color: $muted;
  }

  &__text {
    font-size: $fs-14;
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
    font-size: $fs-11;
    color: $faint;
  }
}

/* 75：发起人还没填时展示的最新回答 */
.latest {
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: $surface;
  border: 1px solid $line;
  border-radius: $r-button;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-bottom: 12px;
  }

  &__title {
    font-size: $fs-14;
    font-weight: 600;
    color: $ink;
  }

  &__sub {
    font-size: $fs-11;
    color: $faint;
  }

  /* 分割线从正文左沿开始（让出 32 头像 + 10 间距），不横穿头像 */
  &__item {
    position: relative;
    display: flex;
    gap: 10px;
    padding: 12px 0;
  }

  &__item + &__item::before {
    content: '';
    position: absolute;
    top: 0;
    left: 42px;
    right: 0;
    height: 1px;
    background: $line;
  }

  &__more {
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__more-text {
    font-size: $fs-12;
    font-weight: 600;
    color: $accent-ink;
  }

  &__body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  &__name {
    font-size: $fs-12;
    font-weight: 500;
    color: $ink;
  }

  &__time {
    font-size: $fs-10;
    color: $faint;
  }

  &__text {
    font-size: $fs-12;
    line-height: 1.5;
    color: $muted;
  }

  &__empty {
    padding: 16px 0 4px;
    text-align: center;
    font-size: $fs-12;
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
    font-size: $fs-14;
    color: $ink;
  }

  &__ph,
  &__hint {
    color: $faint;
  }

  &__hint {
    font-size: $fs-10;
  }

  &__ok {
    width: 100%;
  }
}
</style>
