<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSheet from '@/components/base/AppSheet.vue'
import StepBar from '@/components/business/StepBar.vue'
import { useDraftStore } from '@/stores/draft'
import type { DraftOption } from '@/stores/draft'
import { charCount } from '@/utils/format'
import { bottomInset } from '@/utils/platform'

/**
 * 29 创建 · ② 内容（投票）/ 62 创建 · ② 内容（问卷）/ 33 添加选项弹层
 *
 * 同一页两种形态，由 draft.type 决定：
 *   投票 → 主题 + 说明 + 选项列表（可拖拽排序、可删）
 *   问卷 → 主题 + 说明 + 回答方式预览（只有一段说明，不可编辑）
 *
 * 选项不弹窗输入，直接内联编辑——设计稿 33 的「添加选项」弹层是给
 * 「标题 + 说明」两行一起填的场景，内联反而更快；这里保留弹层，
 * 因为拖拽手柄和序号要占掉一行宽度，内联两行会挤。
 */
const draft = useDraftStore()

const isSurvey = computed(() => draft.draft.type === 'survey')

const title = ref('')
const desc = ref('')

/** 添加选项弹层（33） */
const sheetVisible = ref(false)
const newTitle = ref('')
const newDesc = ref('')

const TITLE_MAX = 60
const DESC_MAX = 200
const OPTION_MAX = 30
const OPTION_DESC_MAX = 40

onLoad(() => {
  draft.restore()
  title.value = draft.draft.title
  desc.value = draft.draft.desc
})

function syncToDraft() {
  draft.patch({ title: title.value, desc: desc.value })
}

function goBack() {
  syncToDraft()
  uni.navigateBack()
}

/** 问卷 → 投票：回到汇总页重新挑选项 */
function goSummary() {
  uni.navigateTo({ url: '/pages/summary/index' })
}

function openAdd() {
  if (draft.draft.options.length >= 12) {
    uni.showToast({ title: '最多 12 个选项', icon: 'none' })
    return
  }
  newTitle.value = ''
  newDesc.value = ''
  sheetVisible.value = true
}

function confirmAdd() {
  const t = newTitle.value.trim()
  if (!t) return
  draft.draft.options.push({ title: t, desc: newDesc.value.trim() || undefined })
  sheetVisible.value = false
  syncToDraft()
}

function removeOption(i: number) {
  draft.draft.options.splice(i, 1)
  syncToDraft()
}

function moveOption(from: number, to: number) {
  if (to < 0 || to >= draft.draft.options.length) return
  const [item] = draft.draft.options.splice(from, 1)
  draft.draft.options.splice(to, 0, item)
  syncToDraft()
}

/** 长按上移 / 下移：小程序没有原生拖拽，用长按菜单代替 */
function onOptionLongPress(i: number) {
  uni.showActionSheet({
    itemList: ['上移', '下移', '删除'],
    success: (r) => {
      if (r.tapIndex === 0) moveOption(i, i - 1)
      else if (r.tapIndex === 1) moveOption(i, i + 1)
      else removeOption(i)
    }
  })
}

const canNext = computed(() => {
  if (!title.value.trim()) return false
  if (isSurvey.value) return true
  return draft.draft.options.filter((o: DraftOption) => o.title.trim()).length >= 2
})

function next() {
  syncToDraft()
  if (!title.value.trim()) {
    uni.showToast({ title: '先填投票主题', icon: 'none' })
    return
  }
  if (!isSurvey.value && draft.draft.options.length < 2) {
    uni.showToast({ title: '至少添加 2 个选项', icon: 'none' })
    return
  }
  uni.navigateTo({ url: '/pages/create/rules' })
}

/** 从问卷汇总进来（83）：选项已经带入，这里只提示来源 */
const fromSurvey = computed(() => !!draft.draft.sourceSurveyId)
</script>

<template>
  <view class="content">
    <AppNavBar :back="false">
      <template #left>
        <text class="content__cancel" @tap="goBack">取消</text>
      </template>
      <template #title>
        <text class="content__nav-title">新建{{ isSurvey ? '问卷' : '投票' }}</text>
      </template>
      <template #right>
        <view class="content__draft">
          <text class="content__draft-text">草稿</text>
        </view>
      </template>
    </AppNavBar>

    <scroll-view class="content__scroll" scroll-y>
      <view class="content__inner">
        <StepBar :current="2" />

        <!-- 投票主题 -->
        <view class="field">
          <text class="field__label">{{ isSurvey ? '问卷主题' : '投票主题' }}</text>
          <view class="field__input" :class="{ 'field__input--focus': title }">
            <input
              v-model="title"
              class="field__input-inner"
              :maxlength="TITLE_MAX"
              :placeholder="isSurvey ? '关于什么，一句话说清楚' : '例如：周末团建活动，你想安排哪些项目？'"
              placeholder-class="field__ph"
              @blur="syncToDraft"
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
              :placeholder="
                isSurvey
                  ? '随便聊聊想去哪、想玩什么，我们会根据大家的回答整理方案。'
                  : '补充背景、规则或预算，帮助参与者判断'
              "
              placeholder-class="field__ph"
              auto-height
              @blur="syncToDraft"
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
            <text v-if="fromSurvey" class="field__link" @tap="goSummary">
              重新整理 ›
            </text>
            <text v-else class="field__optional">长按可排序 / 删除</text>
          </view>

          <view v-if="fromSurvey" class="from-survey">
            <text class="from-survey__text">
              已按回答数带入前 {{ draft.draft.options.length }} 个，其余在「重新整理」里勾选
            </text>
          </view>

          <view class="options">
            <view
              v-for="(opt, i) in draft.draft.options"
              :key="opt.id ?? `new-${i}`"
              class="opt"
              @longpress="onOptionLongPress(i)"
            >
              <view class="opt__index">
                <text class="opt__index-text">{{ i + 1 }}</text>
              </view>
              <view class="opt__text">
                <input
                  v-model="opt.title"
                  class="opt__title-input"
                  :maxlength="OPTION_MAX"
                  placeholder="选项标题"
                  placeholder-class="field__ph"
                  @blur="syncToDraft"
                />
                <input
                  v-model="opt.desc"
                  class="opt__desc-input"
                  :maxlength="OPTION_DESC_MAX"
                  placeholder="补充一句说明（选填）"
                  placeholder-class="field__ph"
                  @blur="syncToDraft"
                />
              </view>
              <view class="opt__handle" @tap.stop="onOptionLongPress(i)">
                <AppIcon name="grip-vertical" :size="16" color="#A1A1AA" />
              </view>
            </view>
          </view>

          <view class="add" hover-class="add--active" @tap="openAdd">
            <AppIcon name="plus" :size="16" color="#71717A" />
            <text class="add__text">添加选项</text>
          </view>
        </view>

        <!-- 回答方式预览（问卷） -->
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

          <text class="field__note">
            问卷没有固定选项，每位参与者填写自己的回答；发起人在数据页逐条查看。
          </text>
        </view>
      </view>
    </scroll-view>

    <view class="content__actions" :style="{ paddingBottom: bottomInset(20) }">
      <view class="content__prev" hover-class="content__prev--active" @tap="goBack">
        <text class="content__prev-text">上一步</text>
      </view>
      <view class="content__next" :class="{ 'content__next--off': !canNext }" @tap="next">
        <text class="content__next-text">下一步</text>
      </view>
    </view>

    <!-- 33 添加选项：标题行右侧是 28 的关闭钮，底部是 48 高的取消/添加 -->
    <AppSheet
      :visible="sheetVisible"
      title="添加选项"
      @close="sheetVisible = false"
    >
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
            <input
              v-model="newTitle"
              :maxlength="OPTION_MAX"
              placeholder="例如：烧烤晚餐"
              placeholder-class="field__ph"
            />
          </view>
        </view>

        <view class="sheet-form__group">
          <view class="sheet-form__head">
            <text class="sheet-form__label">选项说明</text>
            <text class="sheet-form__count">选填</text>
          </view>
          <view class="sheet-form__input">
            <input
              v-model="newDesc"
              :maxlength="OPTION_DESC_MAX"
              placeholder="补充一句说明，帮助参与者判断"
              placeholder-class="field__ph"
            />
          </view>
        </view>
      </view>

      <view class="sheet-tip">
        <AppIcon name="info" :size="12" color="#A1A1AA" />
        <text class="sheet-tip__text">添加后可长按拖拽调整顺序</text>
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
export default { name: 'CreateContentPage' }
</script>

<style lang="scss" scoped>
.content {
  min-height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  &__cancel {
    font-size: 14px;
    color: $muted;
  }

  &__nav-title {
    font-size: 16px;
    font-weight: 600;
    color: $ink;
  }

  &__draft {
    padding: 5px 10px;
    border-radius: 8px;
    background: $accent-soft;
    display: flex;
    align-items: center;
  }

  &__draft-text {
    font-size: 11px;
    font-weight: 600;
    color: $accent;
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

  &__actions {
    display: flex;
    gap: 10px;
    /* 下边距由 bottomInset() 内联控制 */
    padding: 8px $gutter 0;
    flex-shrink: 0;
  }

  &__prev {
    flex: 1;
    height: 52px;
    border-radius: 14px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    justify-content: center;

    &--active {
      background: $subtle;
    }
  }

  &__prev-text {
    font-size: 14px;
    font-weight: 600;
    color: $ink;
  }

  &__next {
    flex: 1;
    height: 52px;
    border-radius: 16px;
    background: $accent;
    display: flex;
    align-items: center;
    justify-content: center;

    &--off {
      opacity: 0.4;
    }
  }

  &__next-text {
    font-size: 16px;
    font-weight: 700;
    color: #fff;
  }
}

/* 字段通用 */
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

  &__link {
    font-size: 11px;
    color: $accent-ink;
  }

  /* 29/33：输入框是 14 圆角、内边距 14 的白卡（聚焦时 2px 描边，用内阴影补足） */
  &__input {
    padding: 14px;
    border-radius: 14px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;

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

  &__note {
    font-size: 11px;
    color: $faint;
    line-height: 1.55;
    padding-top: 2px;
  }
}

/* 选项列表 */
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

  &__handle {
    width: 24px;
    height: 24px;
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

.from-survey {
  padding: 10px 12px;
  border-radius: 10px;
  background: $accent-soft;

  &__text {
    font-size: 11px;
    color: $accent-ink;
    line-height: 1.5;
  }
}

/* 问卷回答方式预览（93）：r14 pad14 gap10，内层 96 高灰框 */
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

/* 添加选项弹层 */
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

/* 33 的提示行：12 号图标 + 10 号灰字 */
.sheet-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 2px;
  margin-top: -4px;

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
