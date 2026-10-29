import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { PollType, PollRules } from '@/types/api'
import { createPoll, updatePoll } from '@/api/poll'

/**
 * 创建流程草稿（28 方式 → 29 内容 → 30 规则）
 *
 * 跨页面共享，退出时落本地缓存，下次进来能续上。
 * 编辑已发布的投票也复用它：mode='edit' 时保存走 PUT 而不是 POST。
 */

export interface DraftOption {
  /** 编辑已有选项时有 id，新增选项没有 */
  id?: string
  title: string
  desc?: string
  /** 编辑时带上原票数，只读展示 */
  votes?: number
  /** 已有票数的选项不可删除 */
  locked?: boolean
}

export interface Draft {
  mode: 'create' | 'edit'
  /** 编辑态：被编辑的投票 id */
  pollId?: string
  type: PollType
  title: string
  desc: string
  options: DraftOption[]
  rules: PollRules
  /** 从问卷汇总创建时，记录来源 */
  sourceSurveyId?: string
  /** 是否已有人投过/答过——决定哪些规则锁死 */
  hasResponses: boolean
  responseCount: number
}

const DRAFT_KEY = 'dyx_draft'

export function createEmptyDraft(type: PollType = 'single'): Draft {
  return {
    mode: 'create',
    type,
    title: '',
    desc: '',
    options: [],
    rules: {
      anonymous: true,
      allowEdit: false,
      allowShare: true,
      limitIp: false,
      allowComment: true,
      allowRepeat: false,
      resultVisibility: 'after_vote',
      shuffleOptions: false,
      hideVoterCount: false,
      joinMethod: 'link',
      profileField: null,
      endAt: Date.now() + 1000 * 60 * 60 * 24 * 3
    },
    hasResponses: false,
    responseCount: 0
  }
}

export const useDraftStore = defineStore('draft', () => {
  const draft = ref<Draft>(createEmptyDraft())

  /** 编辑态下这些规则锁死：改了会让已入库的数据对不上 */
  const lockedRules = computed(() => {
    if (!draft.value.hasResponses) return [] as string[]
    return draft.value.type === 'survey'
      ? ['anonymous', 'joinMethod', 'allowRepeat', 'endAt']
      : ['type', 'anonymous', 'joinMethod']
  })

  function isLocked(key: string) {
    return lockedRules.value.includes(key)
  }

  function startCreate(type: PollType = 'single') {
    draft.value = createEmptyDraft(type)
    persist()
  }

  /** 从已发布的投票/问卷进入编辑 */
  function startEdit(poll: {
    id: string
    type: PollType
    title: string
    desc?: string
    options: Array<{ id: string; title: string; desc?: string; votes: number }>
    rules: PollRules
    responseCount: number
  }) {
    draft.value = {
      mode: 'edit',
      pollId: poll.id,
      type: poll.type,
      title: poll.title,
      desc: poll.desc ?? '',
      options: poll.options.map((o) => ({
        id: o.id,
        title: o.title,
        desc: o.desc,
        votes: o.votes,
        locked: o.votes > 0
      })),
      rules: { ...poll.rules },
      hasResponses: poll.responseCount > 0,
      responseCount: poll.responseCount
    }
    persist()
  }

  function patch(partial: Partial<Draft>) {
    draft.value = { ...draft.value, ...partial }
    persist()
  }

  /**
   * 改写 rules 里的单个字段。
   *
   * 不能写成 draft.rules.xxx = v 再 patch({}) —— 那样 rules 还是同一个对象引用，
   * 页面上的 computed / 模板绑定不会重算，表现为「点了没反应，退出重进才看到」。
   * 这里显式复制一份 rules，保证引用变化。
   */
  function patchRules(partial: Partial<PollRules>) {
    draft.value = {
      ...draft.value,
      rules: { ...draft.value.rules, ...partial }
    }
    persist()
  }

  function reset() {
    draft.value = createEmptyDraft()
    uni.removeStorageSync(DRAFT_KEY)
  }

  function persist() {
    try {
      uni.setStorageSync(DRAFT_KEY, JSON.stringify(draft.value))
    } catch {
      // 草稿太大写不进缓存时忽略，不影响当前流程
    }
  }

  /**
   * 读草稿。
   *
   * 必须按默认值补齐再合并，不能整份覆盖：本地存的是上一个版本写下的 JSON，
   * 新版本加了字段之后，缺字段的旧草稿会让页面在渲染时直接抛错
   * （比如 rules 为 undefined 时读 draft.rules.allowComment），
   * 表现就是「这一页白掉、点什么都没反应」，而且每次进来都一样。
   */
  function restore() {
    try {
      const raw = uni.getStorageSync(DRAFT_KEY)
      if (!raw) return

      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (!parsed || typeof parsed !== 'object') return reset()

      const type: PollType =
        parsed.type === 'survey' || parsed.type === 'multiple' ? parsed.type : 'single'
      const base = createEmptyDraft(type)

      draft.value = {
        ...base,
        ...parsed,
        type,
        options: Array.isArray(parsed.options) ? parsed.options : [],
        rules: { ...base.rules, ...(parsed.rules ?? {}) }
      }
    } catch {
      reset()
    }
  }

  /**
   * 提交：创建走 POST /polls，编辑走 PUT /polls/:id。
   * 返回的 poll 直接给发布成功页用，不用再拉一次详情。
   */
  async function submit() {
    const body = { ...draft.value }
    const saved =
      body.mode === 'edit' && body.pollId
        ? await updatePoll(body.pollId, body)
        : await createPoll(body)
    reset()
    return saved
  }

  return { draft, lockedRules, isLocked, startCreate, startEdit, patch, patchRules, reset, restore, submit }
})
