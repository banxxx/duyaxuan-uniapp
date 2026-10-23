<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import { fetchSummaryCandidates } from '@/api/poll'
import type { SummaryCandidate } from '@/mock/data'
import { charCount } from '@/utils/format'
import { bottomInset } from '@/utils/platform'

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

const candidate = ref<SummaryCandidate | null>(null)
const loading = ref(true)
const title = ref('')
const desc = ref('')
const removed = ref<string[]>([])

/** 归类的回答明细：设计稿只展示前三条，其余折叠 */
const answers = ref<Array<{ id: string; time: string; content: string }>>([])

const candidateId = ref('')

const visibleAnswers = computed(() => answers.value.slice(0, 3))
const restCount = computed(() => Math.max(0, answers.value.length - 3))

async function load() {
  loading.value = true
  try {
    const list = await fetchSummaryCandidates('')
    const hit = list.find((c) => c.id === candidateId.value) ?? list[0]
    candidate.value = hit
    title.value = hit.title
    desc.value = hit.desc
    answers.value = [
      { id: '#8', time: '今天 11:32', content: '想去安吉，竹林露营住一晚，第二天徒步。预算 300 以内可以接受。' },
      { id: '#7', time: '今天 14:27', content: '安吉吧，露营住一晚，第二天走个轻徒步就行。' },
      { id: '#5', time: '今天 14:20', content: '随便都行，不过安吉竹林露营听起来最舒服。' }
    ]
  } finally {
    loading.value = false
  }
}

onLoad((q) => {
  candidateId.value = (q?.id as string) ?? ''
})
onMounted(load)

function removeAnswer(id: string) {
  removed.value.push(id)
  answers.value = answers.value.filter((a) => a.id !== id)
  uni.showToast({ title: '已移出，可在未归类里再处理', icon: 'none' })
}

function onDelete() {
  uni.showModal({
    title: '删除这个候选选项？',
    content: `${candidate.value?.answerCount ?? 0} 条归类的回答会回到「未归类」。`,
    confirmText: '删除',
    confirmColor: '#DC2626',
    success: (r) => {
      if (r.confirm) uni.navigateBack()
    }
  })
}

function save() {
  if (!title.value.trim()) {
    uni.showToast({ title: '选项标题不能为空', icon: 'none' })
    return
  }
  uni.showToast({ title: '已保存', icon: 'none' })
  setTimeout(() => uni.navigateBack(), 500)
}

function goBack() {
  uni.navigateBack()
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
                  <text class="ans__idx-text">{{ a.id }}</text>
                </view>
                <view class="ans__body">
                  <view class="ans__meta">
                    <text class="ans__time">{{ a.time }}</text>
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
  </view>
</template>

<script lang="ts">
export default { name: 'SummaryOptionPage' }
</script>

<style lang="scss" scoped>
.option {
  min-height: 100vh;
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
