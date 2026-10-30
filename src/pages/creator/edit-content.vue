<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { Poll } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSheet from '@/components/base/AppSheet.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import { fetchPoll, updatePoll } from '@/api/poll'
import { charCount } from '@/utils/format'
import { bottomInset } from '@/utils/platform'
import { ROUTES, back, go } from '@/utils/router'
import { cacheDrop, cacheKey } from '@/utils/cache'

/**
 * 90 编辑投票 · 内容 / 93 编辑问卷 · 内容
 *
 * 这一页只管「内容和选项」，规则（匿名、参与方式、截止时间等）在 edit-rules，
 * 通过底部的「规则设置」进入，两页分开保存。
 *
 * 可编辑范围（和后端 updatePoll 的限制一一对应）：
 *   主题 / 说明：随时可改
 *   选项：已有票数的连文字都不能改；没票的可以改、可以删；进行中还能新增
 *   已结束：选项全部锁定，只剩主题 / 说明
 *
 * 导航是「关闭 / 编辑投票 | 编辑问卷 / 已发布」，顶部带一条已发布/已截止的提示。
 */
const poll = ref<Poll | null>(null)
const loading = ref(true)
/** 首屏加载失败：给错误页和重试，不要停在空白页 */
const loadError = ref(false)
const saving = ref(false)

const title = ref('')
const desc = ref('')
const options = ref<Array<{ id?: string; title: string; desc?: string; votes?: number; locked?: boolean }>>([])

const pollId = ref('')

/** 添加选项弹层 */
const sheetVisible = ref(false)
const newTitle = ref('')
const newDesc = ref('')

const TITLE_MAX = 60
const DESC_MAX = 200
const OPTION_MAX = 30

const isSurvey = computed(() => poll.value?.type === 'survey')
const isEnded = computed(() => !!poll.value && poll.value.rules.endAt <= Date.now())

const responseCount = computed(() =>
  isSurvey.value ? poll.value?.answerCount ?? 0 : poll.value?.voterCount ?? 0
)

const hasResponses = computed(() => responseCount.value > 0)

const publishedDays = computed(() => {
  if (!poll.value) return 0
  return Math.max(1, Math.floor((Date.now() - poll.value.createdAt) / 86400000))
})

const publishedText = computed(() => {
  if (!poll.value) return ''
  const tail = isEnded.value ? ' · 已截止' : ''
  if (isSurvey.value) {
    return `已收集 ${publishedDays.value} 天 · ${responseCount.value} 条回答${tail}`
  }
  return `已发布 ${publishedDays.value} 天 · ${responseCount.value} 人已投票${tail}`
})

/** 锁定提示：哪些东西已经不能改（和编辑规则页的分层锁定保持一致） */
const lockNote = computed(() => {
  if (isEnded.value) {
    return `${isSurvey.value ? '问卷' : '投票'}已结束，选项和规则已全部锁定，现在只能修改主题和说明。`
  }
  if (!hasResponses.value) {
    return isSurvey.value
      ? '还没有人提交，主题和说明可以修改；回答方式创建后不可修改。'
      : '还没有人投票，主题、说明和选项都可以修改；投票类型创建后不可修改。'
  }
  return isSurvey.value
    ? '主题和说明可随时修改，已提交的回答不受影响；回答方式已锁定。'
    : '主题和说明可随时修改；已有票数的选项已锁定，没人投过的选项还可以改或删除。'
})

async function load() {
  loading.value = true
  loadError.value = false
  try {
    const p = await fetchPoll(pollId.value)
    poll.value = p
    title.value = p.title
    desc.value = p.desc ?? ''
    options.value = p.options.map((o) => ({
      id: o.id,
      title: o.title,
      desc: o.desc,
      votes: o.votes,
      locked: o.votes > 0
    }))
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

function openAdd() {
  if (isEnded.value) {
    uni.showToast({ title: '已结束，不能再添加选项', icon: 'none' })
    return
  }
  if (options.value.length >= 12) {
    uni.showToast({ title: '最多 12 个选项', icon: 'none' })
    return
  }
  newTitle.value = ''
  newDesc.value = ''
  sheetVisible.value = true
}

/** 幂等：小程序自定义组件内部 tap 会穿出组件边界，和 emit('tap') 叠加触发两次 */
let adding = false

function confirmAdd() {
  if (adding) return
  const t = newTitle.value.trim()
  if (!t) return
  adding = true
  options.value.push({ title: t, desc: newDesc.value.trim() || undefined, votes: 0 })
  sheetVisible.value = false
  newTitle.value = ''
  newDesc.value = ''
  setTimeout(() => {
    adding = false
  }, 300)
}

function removeOption(i: number) {
  const opt = options.value[i]
  if (isEnded.value) {
    uni.showToast({ title: '已结束，不能再删除选项', icon: 'none' })
    return
  }
  if (opt.locked) {
    uni.showToast({ title: `已有 ${opt.votes} 票，不能删除`, icon: 'none' })
    return
  }
  options.value.splice(i, 1)
}

async function save() {
  if (!poll.value) return
  if (!title.value.trim()) {
    uni.showToast({ title: `先填${isSurvey.value ? '问卷' : '投票'}主题`, icon: 'none' })
    return
  }
  if (!isSurvey.value && options.value.length < 2) {
    uni.showToast({ title: '至少保留 2 个选项', icon: 'none' })
    return
  }

  saving.value = true
  try {
    // 已结束：选项和规则都已锁定，只提交主题/说明，避免带上未改动的字段被后端判成越权修改
    const body: Parameters<typeof updatePoll>[1] = {
      title: title.value.trim(),
      desc: desc.value.trim()
    }
    if (!isEnded.value) {
      body.type = poll.value.type
      body.options = options.value.map((o) => ({
        id: o.id,
        title: o.title.trim(),
        desc: o.desc,
        votes: o.votes
      }))
    }
    const next = await updatePoll(poll.value.id, body)
    poll.value = next
    // 改过内容，这条投票的所有快照作废：标题、选项都变了，不能先显示旧的
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

function goRules() {
  go(ROUTES.creatorEditRules, { id: pollId.value })
}
</script>

<template>
  <view class="edit">
    <AppNavBar :back="false">
      <template #left>
        <text class="edit__close" @tap="close">关闭</text>
      </template>
      <template #title>
        <text class="edit__nav-title">编辑{{ isSurvey ? '问卷' : '投票' }}</text>
      </template>
      <template #right>
        <view class="edit__status" :class="{ 'edit__status--ended': isEnded }">
          <text class="edit__status-text" :class="{ 'edit__status-text--ended': isEnded }">
            {{ isEnded ? '已结束' : '已发布' }}
          </text>
        </view>
      </template>
    </AppNavBar>

    <view v-if="loading" class="edit__body">
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

    <scroll-view v-else-if="poll" class="edit__scroll" scroll-y>
      <view class="edit__inner">
        <!-- 已发布提示条：图标 + 两行文案，r12 pad[12,14] gap10 -->
        <view class="notice">
          <AppIcon name="triangle-alert" :size="16" color="#D97706" />
          <view class="notice__text">
            <text class="notice__title">{{ publishedText }}</text>
            <text class="notice__desc">{{ lockNote }}</text>
          </view>
        </view>

        <!-- 主题 -->
        <view class="field">
          <text class="field__label">{{ isSurvey ? '问卷主题' : '投票主题' }}</text>
          <view class="field__input" :class="{ 'field__input--focus': title }">
            <input
              v-model="title"
              class="field__input-inner"
              :maxlength="TITLE_MAX"
              placeholder="建议 20 字以内，说明清楚"
              placeholder-class="field__ph"
            />
          </view>
          <view class="field__foot">
            <text class="field__hint">建议 20 字以内，说明清楚</text>
            <text class="field__count">{{ charCount(title) }}/{{ TITLE_MAX }}</text>
          </view>
        </view>

        <!-- 说明 -->
        <view class="field">
          <view class="field__head">
            <text class="field__label">{{ isSurvey ? '问卷说明' : '投票说明' }}</text>
            <text class="field__optional">选填</text>
          </view>
          <view class="field__textarea">
            <textarea
              v-model="desc"
              class="field__textarea-inner"
              :maxlength="DESC_MAX"
              placeholder="补充背景、规则或预算，帮助参与者判断"
              placeholder-class="field__ph"
            />
          </view>
          <view class="field__foot field__foot--end">
            <text class="field__count">{{ charCount(desc) }}/{{ DESC_MAX }}</text>
          </view>
        </view>

        <!-- 选项（投票） -->
        <view v-if="!isSurvey" class="field">
          <view class="field__head">
            <text class="field__label">选项</text>
            <text class="field__optional">
              {{ isEnded ? '已结束 · 全部锁定' : '有票数的选项已锁定' }}
            </text>
          </view>

          <view class="options">
            <view
              v-for="(opt, i) in options"
              :key="opt.id ?? `new-${i}`"
              class="opt"
              :class="{ 'opt--locked': opt.locked || isEnded }"
            >
              <view class="opt__index">
                <text class="opt__index-text">{{ i + 1 }}</text>
              </view>

              <view class="opt__text">
                <input
                  v-model="opt.title"
                  class="opt__title-input"
                  :class="{ 'opt__input--locked': opt.locked || isEnded }"
                  :disabled="opt.locked || isEnded"
                  :maxlength="OPTION_MAX"
                  placeholder="选项标题"
                  placeholder-class="field__ph"
                />
                <input
                  v-model="opt.desc"
                  class="opt__desc-input"
                  :class="{ 'opt__input--locked': opt.locked || isEnded }"
                  :disabled="opt.locked || isEnded"
                  :maxlength="40"
                  placeholder="补充一句说明（选填）"
                  placeholder-class="field__ph"
                />
              </view>

              <view v-if="opt.locked || isEnded" class="opt__votes">
                <text class="opt__votes-text">{{ opt.votes }} 票</text>
              </view>
              <view v-else class="opt__remove" @tap="removeOption(i)">
                <AppIcon name="x" :size="14" color="#A1A1AA" />
              </view>
            </view>
          </view>

          <view v-if="!isEnded" class="add" hover-class="add--active" @tap="openAdd">
            <AppIcon name="plus" :size="16" color="#71717A" />
            <text class="add__text">添加选项（不计入已有票数）</text>
          </view>
        </view>

        <!-- 回答方式（问卷，已锁定） -->
        <view v-else class="field">
          <view class="field__head">
            <text class="field__label">回答方式</text>
            <text class="field__optional">参与者看到的样子</text>
          </view>

          <view class="preview">
            <view class="preview__top">
              <AppIcon name="message-square-text" :size="15" color="#71717A" />
              <text class="preview__label">填写你的回答</text>
            </view>
            <view class="preview__box">
              <text class="preview__ph">说说你的想法…</text>
            </view>
            <view class="preview__foot">
              <text class="preview__count">0/500</text>
              <text class="preview__hint">可跳过，不作答也能提交</text>
            </view>
          </view>

          <text class="edit__lock-note">
            回答框写法和字数上限创建后不可修改，已提交的回答不会受影响。
          </text>
        </view>

        <!-- 内容页只改文字和选项；匿名、参与方式、截止时间在规则页，分开保存 -->
        <view class="rules-link" hover-class="rules-link--active" @tap="goRules">
          <view class="rules-link__text">
            <text class="rules-link__title">规则设置</text>
            <text class="rules-link__desc">
              {{ isEnded ? '已结束，规则不可再修改' : '匿名、参与方式、截止时间、结果可见性' }}
            </text>
          </view>
          <AppIcon name="chevron-right" :size="16" color="#A1A1AA" />
        </view>
      </view>
    </scroll-view>

    <view v-if="poll" class="edit__actions" :style="{ paddingBottom: bottomInset(20) }">
      <AppButton type="subtle" size="action" :radius="14" class="edit__action" @tap="close">取消</AppButton>
      <AppButton size="submit" :loading="saving" class="edit__action" @tap="save">保存修改</AppButton>
    </view>

    <AppSheet :visible="sheetVisible" title="添加选项" @close="sheetVisible = false">
      <template #head-extra>
        <view class="sheet-close" @tap="sheetVisible = false">
          <AppIcon name="x" :size="14" color="#71717A" />
        </view>
      </template>

      <view class="sheet-form">
        <view class="sheet-form__group">
          <view class="sheet-form__head">
            <text class="sheet-form__label">选项标题</text>
            <text class="sheet-form__count">{{ charCount(newTitle) }}/{{ OPTION_MAX }}</text>
          </view>
          <view class="sheet-form__input" :class="{ 'sheet-form__input--focus': newTitle }">
            <input v-model="newTitle" :maxlength="OPTION_MAX" placeholder="例如：烧烤晚餐" placeholder-class="field__ph" />
          </view>
        </view>

        <view class="sheet-form__group">
          <view class="sheet-form__head">
            <text class="sheet-form__label">选项说明</text>
            <text class="sheet-form__count">选填</text>
          </view>
          <view class="sheet-form__input">
            <input v-model="newDesc" :maxlength="40" placeholder="补充一句说明" placeholder-class="field__ph" />
          </view>
        </view>
      </view>

      <view class="sheet-tip">
        <AppIcon name="info" :size="12" color="#A1A1AA" />
        <text class="sheet-tip__text">新选项从 0 票起算，不计入已有票数</text>
      </view>

      <template #footer>
        <view class="sheet-actions">
          <AppButton type="outline" size="inline" class="sheet-actions__btn" @tap="sheetVisible = false">
            取消
          </AppButton>
          <AppButton size="inline" class="sheet-actions__btn" :disabled="!newTitle.trim()" @tap="confirmAdd">
            添加
          </AppButton>
        </view>
      </template>
    </AppSheet>
  </view>
</template>

<script lang="ts">
export default { name: 'EditContentPage' }
</script>

<style lang="scss" scoped>
.edit {
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

  /* 已结束不再用「已发布」的紫标，改成中性灰 */
  &__status--ended {
    background: $subtle;
  }

  &__status-text--ended {
    color: $faint;
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

  /* 90/93：底部两个等宽按钮，取消是 14 圆角白底，保存是 16 圆角紫底 16/700 */
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

  /* 93 的锁定说明是纯文字，不是灰底卡 */
  &__lock-note {
    font-size: 11px;
    color: $faint;
    line-height: 1.55;
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

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__label {
    font-size: 13px;
    font-weight: 600;
    color: $ink;
  }

  &__optional {
    font-size: 11px;
    color: $faint;
  }

  &__input {
    padding: 14px;
    border-radius: 14px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;

    /* 设计稿聚焦态是 2px 描边；用内阴影补足 1px，避免边框变粗带来位移 */
    &--focus {
      border-color: $accent;
      box-shadow: inset 0 0 0 1px $accent;
    }
  }

  &__input-inner {
    flex: 1;
    font-size: 15px;
    color: $ink;
    line-height: 1.4;
  }

  &__textarea {
    height: 76px;
    padding: 14px;
    border-radius: 14px;
    background: $surface;
    border: 1px solid $line;
  }

  &__textarea-inner {
    width: 100%;
    height: 100%;
    font-size: 12px;
    color: $ink;
    line-height: 1.55;
  }

  &__ph {
    color: $faint;
  }

  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;

    &--end {
      justify-content: flex-end;
    }
  }

  &__hint,
  &__count {
    font-size: 11px;
    color: $faint;
  }
}

.options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.opt {
  padding: 11px 13px;
  border-radius: 12px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  gap: 10px;

  &__index {
    width: 22px;
    height: 22px;
    border-radius: 7px;
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
  }

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  &__title-input {
    font-size: 14px;
    font-weight: 500;
    color: $ink;
  }

  &__desc-input {
    font-size: 11px;
    color: $muted;
  }

  /* 有票数 / 已结束：输入框只读，视觉上退成正文色，避免看起来还能点 */
  &__input--locked {
    color: $muted;
    opacity: 1;
    -webkit-text-fill-color: $muted;
  }

  &__votes {
    height: 22px;
    padding: 0 8px;
    border-radius: 6px;
    background: $subtle;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  &__votes-text {
    font-size: 10px;
    font-weight: 600;
    color: $faint;
  }

  &__remove {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
}

.add {
  height: 44px;
  border-radius: 12px;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;

  &--active {
    background: $subtle;
  }

  &__text {
    font-size: 13px;
    color: $muted;
  }
}

/* 规则设置入口：和 33 的卡片同款描边，右侧箭头表示会进下一页 */
.rules-link {
  padding: 14px;
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  gap: 10px;

  &--active {
    background: $subtle;
  }

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  &__title {
    font-size: 14px;
    font-weight: 500;
    color: $ink;
  }

  &__desc {
    font-size: 11px;
    color: $faint;
  }
}

/* 93 的回答方式预览：r14 pad14 gap10，内层 96 高灰框 */
.preview {
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
    gap: 8px;
  }

  &__label {
    font-size: 11px;
    color: $muted;
  }

  &__box {
    height: 96px;
    padding: 12px;
    border-radius: 10px;
    background: $bg;
  }

  &__ph {
    font-size: 13px;
    color: $faint;
  }

  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__count,
  &__hint {
    font-size: 11px;
    color: $faint;
  }
}

.sheet-form {
  display: flex;
  flex-direction: column;
  gap: 14px;

  &__group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__label {
    font-size: 12px;
    font-weight: 600;
    color: $ink;
  }

  &__count {
    font-size: 10px;
    color: $faint;
  }

  /* 33：白底 + 1px $line，12 圆角，内边距 12 */
  &__input {
    padding: 12px;
    border-radius: 12px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    font-size: 13px;
    color: $ink;

    &--focus {
      border-color: $accent;
      box-shadow: inset 0 0 0 1px $accent;
    }
  }
}

/* 33 的关闭钮：28 圆、$subtle 底 */
.sheet-close {
  width: 28px;
  height: 28px;
  border-radius: 14px;
  background: $subtle;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/*
 * 33 的提示行：12 号图标 + 10 号灰字。
 * 弹层 body 是普通 view，没有 gap —— 间距得自己给，否则会紧贴上面的输入框。
 */
.sheet-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;

  &__text {
    font-size: 10px;
    color: $faint;
  }
}

.sheet-actions {
  display: flex;
  align-items: center;
  gap: 10px;

  &__btn {
    flex: 1;
  }
}
</style>
