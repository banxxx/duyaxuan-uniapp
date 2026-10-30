<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import AppConfirmSheet from '@/components/base/AppConfirmSheet.vue'
import {
  deleteSummaryOption,
  fetchSummaryOption,
  unassignSummaryAnswer,
  updateSummaryOption
} from '@/api/poll'
import type { SummaryAnswer, SummaryOptionDetail } from '@/types/api'
import { charCount, formatRelative } from '@/utils/format'
import { bottomInset } from '@/utils/platform'
import { back } from '@/utils/router'
import { cacheGet, cacheSet, cacheDrop, cacheKey } from '@/utils/cache'

/**
 * 85 汇总 · 编辑选项
 *
 * 改标题（≤12 字）和说明（≤20 字），或者把某几条回答「移出」——
 * 移出的回答回到 86 未归类，可以再归到别的选项，不会丢。
 *
 * 12/20 这两个上限是设计稿定的：投票里标题一行放得下、说明不换行，
 * 超过这个长度的归并结果本来就该拆成两个选项。
 */
const TITLE_MAX = 12
const DESC_MAX = 20

const candidate = ref<SummaryOptionDetail | null>(null)
const loading = ref(true)
/** 首屏加载失败：没有缓存内容时给错误页，而不是空白页 */
const loadError = ref(false)
const saving = ref(false)
const title = ref('')
const desc = ref('')

/** 归类的回答明细：设计稿只展示前三条，其余折叠 */
const answers = ref<SummaryAnswer[]>([])

const surveyId = ref('')
const optionId = ref('')

const visibleAnswers = computed(() => answers.value.slice(0, 3))
const restCount = computed(() => Math.max(0, answers.value.length - 3))

/** 选项编辑页快照：先把上次的内容铺上，再刷新 */
interface OptionSnapshot {
  detail: SummaryOptionDetail
}

function applyDetail(detail: SummaryOptionDetail) {
  candidate.value = detail
  title.value = detail.title
  desc.value = detail.desc
  answers.value = detail.answers
}

async function load() {
  const cached = cacheGet<OptionSnapshot>(cacheKey.summaryOption(surveyId.value, optionId.value))
  if (cached) applyDetail(cached.detail)
  loading.value = !cached
  loadError.value = false
  try {
    const detail = await fetchSummaryOption(surveyId.value, optionId.value)
    applyDetail(detail)
    cacheSet(cacheKey.summaryOption(surveyId.value, optionId.value), { detail })
  } catch {
    // 有缓存就继续用缓存；连缓存都没有才整页报错
    if (!candidate.value) loadError.value = true
  } finally {
    loading.value = false
  }
}

onLoad((q) => {
  optionId.value = (q?.id as string) ?? ''
  surveyId.value = (q?.surveyId as string) ?? ''
})
onMounted(load)

async function removeAnswer(id: string) {
  try {
    await unassignSummaryAnswer(surveyId.value, optionId.value, id)
    answers.value = answers.value.filter((a) => a.id !== id)
    cacheDrop(cacheKey.summaryOption(surveyId.value, optionId.value))
    uni.showToast({ title: '已移出，可在未归类里再处理', icon: 'none' })
  } catch {
    uni.showToast({ title: '移出失败，请重试', icon: 'none' })
  }
}

const deleteVisible = ref(false)

function onDelete() {
  deleteVisible.value = true
}

async function doDelete() {
  deleteVisible.value = false
  try {
    await deleteSummaryOption(surveyId.value, optionId.value)
    cacheDrop(cacheKey.summaryOption(surveyId.value, optionId.value))
    uni.showToast({ title: '已删除', icon: 'none' })
    setTimeout(back, 400)
  } catch {
    uni.showToast({ title: '删除失败，请重试', icon: 'none' })
  }
}

async function save() {
  if (!title.value.trim()) {
    uni.showToast({ title: '选项标题不能为空', icon: 'none' })
    return
  }
  if (saving.value) return
  saving.value = true
  try {
    await updateSummaryOption(surveyId.value, optionId.value, {
      title: title.value.trim(),
      desc: desc.value.trim()
    })
    cacheDrop(cacheKey.summaryOption(surveyId.value, optionId.value))
    uni.showToast({ title: '已保存', icon: 'none' })
    setTimeout(back, 400)
  } catch {
    uni.showToast({ title: '保存失败，请重试', icon: 'none' })
  } finally {
    saving.value = false
  }
}

function goBack() {
  back()
}
</script>

<template>
  <view class="option">
    <AppNavBar title="编辑选项">
      <template #right>
        <text class="option__delete" @tap="onDelete">删除</text>
      </template>
    </AppNavBar>

    <view v-if="loading" class="option__body">
      <AppSkeleton type="list" />
    </view>

    <AppEmpty
      v-else-if="loadError"
      icon="wifi-off"
      title="选项加载失败"
      desc="网络不太稳定，或者这个选项已经被删除"
      action="重新加载"
      action-icon="refresh-cw"
      @action="load"
    />

    <template v-else-if="candidate">
      <scroll-view class="option__scroll" scroll-y>
        <view class="option__content">
          <view class="field">
            <text class="field__label">选项标题</text>
            <view class="field__input" :class="{ 'field__input--focus': title }">
              <input
                v-model="title"
                class="field__input-inner"
                :maxlength="TITLE_MAX"
                placeholder="例如：安吉 · 竹林露营"
                placeholder-class="field__ph"
              />
            </view>
            <view class="field__foot">
              <text class="field__hint">建议 {{ TITLE_MAX }} 字以内，投票里一行能放下</text>
              <text class="field__count">{{ charCount(title) }}/{{ TITLE_MAX }}</text>
            </view>
          </view>

          <view class="field">
            <text class="field__label">选项说明</text>
            <view class="field__input field__input--area">
              <input
                v-model="desc"
                class="field__input-inner"
                :maxlength="DESC_MAX"
                placeholder="竹林露营住一晚，第二天轻徒步"
                placeholder-class="field__ph"
              />
            </view>
            <text class="field__hint">
              来自 {{ answers.length }} 条回答的共同点，投票参与者会看到这行小字
            </text>
          </view>

          <!-- 归类的回答：整卡白底、答案行左缩进的分隔线 -->
          <view class="answers">
            <view class="answers__head">
              <text class="answers__title">归类的回答</text>
              <view class="answers__badge">
                <text class="answers__badge-text">{{ answers.length }} 条</text>
              </view>
            </view>

            <template v-for="(a, i) in visibleAnswers" :key="a.id">
              <view v-if="i > 0" class="answers__sep" />
              <view class="ans">
                <view class="ans__idx">
                  <text class="ans__idx-text">{{ i + 1 }}</text>
                </view>
                <view class="ans__body">
                  <view class="ans__meta">
                    <text class="ans__time">{{ formatRelative(a.createdAt) }}</text>
                    <view class="ans__remove" @tap="removeAnswer(a.id)">
                      <AppIcon name="x" :size="12" color="#A1A1AA" />
                      <text class="ans__remove-text">移出</text>
                    </view>
                  </view>
                  <text class="ans__content">{{ a.content }}</text>
                </view>
              </view>
            </template>

            <view v-if="restCount" class="answers__more">
              <text class="answers__more-text">查看全部 {{ answers.length }} 条 ›</text>
            </view>

            <AppEmpty
              v-if="!answers.length"
              icon="inbox"
              title="这个选项没有归类的回答"
              desc="它会以空选项的形式进入投票，建议直接删除"
            />
          </view>

          <view class="option__note">
            <AppIcon name="info" :size="13" color="#A1A1AA" />
            <text class="option__note-text">
              移出的回答会回到「未归类」，可以再归到别的选项。
            </text>
          </view>
        </view>
      </scroll-view>

      <view class="option__actions" :style="{ paddingBottom: bottomInset(20) }">
        <AppButton type="subtle" size="cta" class="option__action" @tap="goBack">取消</AppButton>
        <AppButton size="cta" class="option__action" @tap="save">保存</AppButton>
      </view>
    </template>

    <AppConfirmSheet
      :visible="deleteVisible"
      title="删除这个候选选项？"
      :desc="`${answers.length} 条归类的回答会回到「未归类」。`"
      confirm-text="删除"
      danger
      @close="deleteVisible = false"
      @confirm="doDelete"
    />
  </view>
</template>

<script lang="ts">
export default { name: 'SummaryOptionPage' }
</script>

<style lang="scss" scoped>
.option {
  /* 定高：scroll-view 需要父级有确定高度，min-height 在真机上会让它塌成 0 高 */
  height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  /* 85 页头右侧是 14 号灰字「删除」，不是红色 */
  &__delete {
    font-size: 14px;
    color: $muted;
  }

  &__body {
    flex: 1;
  }

  &__scroll {
    flex: 1;
    height: 0;
  }

  &__content {
    padding: 4px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  &__note {
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }

  &__note-text {
    flex: 1;
    font-size: 11px;
    color: $faint;
    line-height: 1.5;
  }

  &__actions {
    display: flex;
    gap: 10px;
    /* 下边距由 bottomInset() 内联控制 */
    padding: 8px $gutter 0;
    flex-shrink: 0;
  }

  &__action {
    flex: 1;
    font-size: 15px;
    font-weight: 600;
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;

  &__label {
    font-size: 13px;
    font-weight: 600;
    color: $ink;
  }

  /* 85：白卡 r14 pad14，聚焦态 2px 紫描边 */
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
  }

  &__ph {
    color: $faint;
  }

  &__foot {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  &__hint {
    flex: 1;
    font-size: 10px;
    color: $faint;
    line-height: 1.45;
  }

  &__count {
    font-size: 10px;
    color: $faint;
    flex-shrink: 0;
  }
}

/* 归类的回答：白卡 r16，内部行内边距 [12,16] */
.answers {
  border-radius: 16px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  flex-direction: column;

  &__head {
    padding: 16px 16px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    color: $ink;
  }

  &__badge {
    padding: 3px 8px;
    border-radius: 6px;
    background: $accent-soft;
    display: flex;
    align-items: center;
  }

  &__badge-text {
    font-size: 10px;
    color: $accent-ink;
  }

  /* 分隔线从序号右侧起，和答案文字左对齐 */
  &__sep {
    height: 1px;
    margin-left: 38px;
    background: $line;
  }

  &__more {
    padding: 14px 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__more-text {
    font-size: 12px;
    font-weight: 600;
    color: $accent;
  }
}

.ans {
  padding: 12px 16px;
  display: flex;
  align-items: flex-start;
  gap: 10px;

  &__idx {
    width: 28px;
    height: 28px;
    border-radius: 9px;
    background: $subtle;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__idx-text {
    font-size: 10px;
    font-weight: 600;
    color: $muted;
  }

  &__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  &__meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  &__time {
    font-size: 10px;
    color: $faint;
  }

  &__remove {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  &__remove-text {
    font-size: 10px;
    color: $faint;
  }

  &__content {
    font-size: 12px;
    color: $ink;
    line-height: 1.5;
  }
}
</style>
