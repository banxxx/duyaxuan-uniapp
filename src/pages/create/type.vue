<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { PollType } from '@/types/api'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import StepBar from '@/components/business/StepBar.vue'
import { useDraftStore } from '@/stores/draft'
import { bottomInset, getSafeArea } from '@/utils/platform'
import { back, go, ROUTES } from '@/utils/router'

/**
 * 28 创建 · ① 方式（含 82 来自问卷）
 *
 * 五种类型，只有前两种能选，其余挂「即将支持」——不隐藏，
 * 因为让人看到「以后会有图文/视频投票」比凭空消失更可信。
 *
 * 82 来自问卷：从问卷数据页点「汇总成投票」进来，顶部多一条来源条，
 * 并且「问卷收集」被置灰（已经是从问卷来的，不能再选问卷）。
 * 这里用 query.source 判断，不单独开一页。
 */
interface TypeItem {
  key: PollType | 'image' | 'video' | 'more'
  title: string
  desc: string
  icon: string
  soon?: boolean
  disabledReason?: string
}

const draft = useDraftStore()

/**
 * 步骤条吸顶要停在导航栏下沿，而导航栏是 fixed 的，
 * 所以 sticky 的 top 得自己算：状态栏 + 导航条。
 */
const { statusBarHeight, navBarHeight } = getSafeArea()
const navTotal = statusBarHeight + navBarHeight

const selected = ref<PollType>('single')
const sourceSurveyId = ref('')
const sourceSurveyTitle = ref('')
const sourceCount = ref(0)

const types: TypeItem[] = [
  { key: 'single', title: '单选 / 多选', desc: '最常用的选择型投票，可限制每人选几项', icon: 'list-checks' },
  { key: 'survey', title: '问卷收集', desc: '没有固定选项，参与者自由填写回答', icon: 'message-square-text' },
  { key: 'image', title: '图文投票', desc: '选项带图片，适合作品与方案评选', icon: 'image', soon: true },
  { key: 'video', title: '视频投票', desc: '选项带视频，适合短视频征集', icon: 'video', soon: true },
  { key: 'more', title: '更多类型', desc: '排序、评分、打分等进阶形式', icon: 'sparkles', soon: true }
]

onLoad((q) => {
  if (q?.source) {
    sourceSurveyId.value = String(q.source)
    sourceSurveyTitle.value = String(q.title ?? '问卷')
    sourceCount.value = Number(q.count ?? 0)
    selected.value = 'single'
  }
})

function isDisabled(t: TypeItem) {
  if (t.soon) return true
  // 来自问卷时不能再选问卷
  return !!sourceSurveyId.value && t.key === 'survey'
}

function pick(t: TypeItem) {
  if (isDisabled(t)) {
    if (t.soon) uni.showToast({ title: '该类型即将支持', icon: 'none' })
    else uni.showToast({ title: '已从问卷发起，不能再选问卷', icon: 'none' })
    return
  }
  selected.value = t.key as PollType
}

function next() {
  draft.startCreate(selected.value)
  if (sourceSurveyId.value) {
    draft.patch({ sourceSurveyId: sourceSurveyId.value })
  }
  go(ROUTES.createContent)
}

function cancel() {
  back()
}

function changeSource() {
  back()
}
</script>

<template>
  <view class="type-page">
    <AppNavBar :back="false">
      <template #left>
        <text class="type-page__cancel" @tap="cancel">取消</text>
      </template>
      <template #title>
        <text class="type-page__nav-title">新建{{ selected === 'survey' ? '问卷' : '投票' }}</text>
      </template>
      <template #right>
        <view class="type-page__draft">
          <text class="type-page__draft-text">草稿</text>
        </view>
      </template>
    </AppNavBar>

    <view class="type-page__content">
      <!-- 82 来源条：$accent-soft r14 pad[12,14]，左侧 30 的白底图标块 -->
      <view v-if="sourceSurveyId" class="source">
        <view class="source__icon">
          <AppIcon name="sparkles" :size="15" color="#4F46E5" />
        </view>
        <view class="source__body">
          <text class="source__label">来自问卷 · {{ sourceCount }} 条回答已整理</text>
          <text class="source__title">{{ sourceSurveyTitle }}</text>
        </view>
        <text class="source__change" @tap="changeSource">更换</text>
      </view>

      <!-- 这一页是整页原生滚动，步骤条用 sticky 贴在导航栏下沿 -->
      <view class="type-page__steps" :style="{ top: `${navTotal}px` }">
        <StepBar :current="1" />
      </view>

      <view class="head">
        <text class="head__title">选择投票方式</text>
        <text class="head__sub">
          {{ sourceSurveyId ? '和普通投票一样，先定单选还是多选' : '先定形式，后续步骤会按该形式调整' }}
        </text>
      </view>

      <view class="list">
        <view
          v-for="t in types"
          :key="t.key"
          class="item"
          :class="{
            'item--on': selected === t.key && !isDisabled(t),
            'item--off': isDisabled(t)
          }"
          @tap="pick(t)"
        >
          <view class="item__icon" :class="{ 'item__icon--on': selected === t.key && !isDisabled(t) }">
            <AppIcon
              :name="t.icon"
              :size="18"
              :color="selected === t.key && !isDisabled(t) ? '#FFFFFF' : '#A1A1AA'"
            />
          </view>

          <view class="item__text">
            <text class="item__title" :class="{ 'item__title--on': selected === t.key && !isDisabled(t) }">
              {{ t.title }}
            </text>
            <text class="item__desc">
              {{
                sourceSurveyId && t.key === 'survey'
                  ? '已从问卷发起，不能再选问卷'
                  : t.desc
              }}
            </text>
          </view>

          <view v-if="selected === t.key && !isDisabled(t)" class="item__check">
            <AppIcon name="check" :size="12" color="#FFFFFF" :stroke-width="3" />
          </view>

          <view v-else-if="t.soon" class="item__soon">
            <text class="item__soon-text">即将支持</text>
          </view>

          <view v-else-if="isDisabled(t)" class="item__soon">
            <text class="item__soon-text">不可选</text>
          </view>
        </view>
      </view>
    </view>

    <view class="type-page__actions" :style="{ paddingBottom: bottomInset(20) }">
      <AppButton @tap="next">下一步</AppButton>
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'CreateTypePage' }
</script>

<style lang="scss" scoped>
.type-page {
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

  &__content {
    flex: 1;
    padding: 4px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /*
   * 步骤条吸顶。
   *
   * 这一页没有 scroll-view（内容靠原生页面滚动），所以用 sticky：
   * top 由内联 style 给（状态栏 + 导航条），正好停在导航栏下沿。
   * 左右负外边距出血到屏幕边缘 —— 内容区有 20 的左右内边距，
   * 不出血的话滚动时内容会从步骤条两侧露出来。
   */
  &__steps {
    position: sticky;
    z-index: 20;
    margin: 0 (-$gutter);
    padding: 4px $gutter;
    background: $bg;
  }

  &__actions {
    /* 下边距由 bottomInset() 内联控制 */
    padding: 8px $gutter 0;
    flex-shrink: 0;
  }
}

/* 82 来源条：$accent-soft r14 pad[12,14] gap10，图标 30 白底块，文字两行 */
.source {
  padding: 12px 14px;
  border-radius: 14px;
  background: $accent-soft;
  display: flex;
  align-items: center;
  gap: 10px;

  &__icon {
    width: 30px;
    height: 30px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__label {
    font-size: 12px;
    font-weight: 600;
    color: $accent-ink;
  }

  &__change {
    font-size: 11px;
    color: $accent;
    flex-shrink: 0;
  }

  &__title {
    font-size: 11px;
    color: $muted;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
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
    color: $faint;
  }
}

.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.item {
  padding: 14px;
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  gap: 12px;

  &--on {
    background: $accent-soft;
    border: 2px solid $accent;
    padding: 13px;
  }

  /* 82：不可选（已从问卷发起）整块退成 $subtle，标题也变浅 */
  &--off {
    background: $subtle;

    .item__title {
      color: $faint;
    }
  }

  &__icon {
    width: 38px;
    height: 38px;
    border-radius: 12px;
    background: $subtle;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;

    &--on {
      background: $accent;
    }
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
    font-weight: 600;
    color: $ink;

    &--on {
      color: $accent-ink;
    }
  }

  &__desc {
    font-size: 11px;
    color: $faint;
    line-height: 1.4;
  }

  &__check {
    width: 20px;
    height: 20px;
    border-radius: 10px;
    background: $accent;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__soon {
    padding: 4px 8px;
    border-radius: 8px;
    background: $subtle;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  &__soon-text {
    font-size: 10px;
    font-weight: 500;
    color: $faint;
  }
}
</style>
