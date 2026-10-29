<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/base/AppIcon.vue'
import { percent } from '@/utils/format'

/**
 * 选项条 —— 05/06 待投票、07/08 待投票但结果可见、09-12 已投票、21 结果页 共用
 *
 * 设计稿里是同一张卡片的四种形态，用 mode 区分：
 *
 *   vote         05/06  圆点 + 标题 + 说明；圆角 14、内边距 14、元素间距 12
 *   vote-result  07/08  同 vote，行尾多一列「41 票 · 46%」（宽 76、右对齐）
 *   result       09/11  竖向：勾选图标 + 标题行 + 票数，下面 6 高进度条，行距 8
 *   locked       10/12  52 高紧凑行：circle / circle-check 图标 + 标题，不显示票数
 *
 * 选中态统一是 $accent-soft 底 + $accent 描边，标题加粗。
 */
const props = withDefaults(
  defineProps<{
    title: string
    desc?: string
    votes?: number
    total?: number
    /** 单选还是多选，决定选中框形状 */
    multiple?: boolean
    selected?: boolean
    mode?: 'vote' | 'vote-result' | 'result' | 'locked'
    /** 不可点（已截止、已投票、无权限） */
    disabled?: boolean
  }>(),
  {
    multiple: false,
    selected: false,
    mode: 'vote',
    disabled: false
  }
)

const emit = defineEmits<{ (e: 'select'): void }>()

const pct = computed(() => percent(props.votes ?? 0, props.total ?? 0))

/** 票数只在两种「看结果」的形态里出现 */
const showVotes = computed(() => props.mode === 'vote-result' || props.mode === 'result')

const readonly = computed(() => props.mode === 'result' || props.mode === 'locked' || props.disabled)
</script>

<template>
  <view
    class="option"
    :class="[`option--${mode}`, { 'option--selected': selected }]"
    :hover-class="readonly ? 'none' : 'option--active'"
    @tap="!readonly && emit('select')"
  >
    <view class="option__row">
      <view class="option__left">
        <!-- 10/12：结果隐藏，只标出我选的那条；单选圆形、多选方形 -->
        <AppIcon
          v-if="mode === 'locked'"
          :name="selected ? (multiple ? 'square-check' : 'circle-check') : multiple ? 'square' : 'circle'"
          :size="16"
          :color="selected ? '#4F46E5' : '#A1A1AA'"
        />

        <!-- 09/11：结果可见，选中项用勾选图标替掉圆点 -->
        <AppIcon
          v-else-if="mode === 'result' && selected"
          name="circle-check"
          :size="15"
          color="#4F46E5"
          :stroke-width="2"
        />

        <!-- 05-08：待投票，20 圆点 / 圆角方块 -->
        <view
          v-else
          class="option__mark"
          :class="{ 'option__mark--multi': multiple, 'option__mark--on': selected }"
        >
          <AppIcon
            v-if="selected"
            class="option__check anim anim--pop"
            name="check"
            :size="12"
            color="#FFFFFF"
            :stroke-width="3"
          />
        </view>

        <view class="option__text">
          <text class="option__title">{{ title }}</text>
          <text v-if="desc && (mode === 'vote' || mode === 'vote-result')" class="option__desc">
            {{ desc }}
          </text>
        </view>
      </view>

      <text v-if="showVotes" class="option__value">{{ votes ?? 0 }} 票 · {{ pct }}%</text>
    </view>

    <view v-if="mode === 'result'" class="option__track">
      <!-- 票数条从左往右长出来，宽度仍是 inline style，动效只做 scaleX -->
      <view class="option__fill anim anim--grow" :style="{ width: `${pct}%` }" />
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'OptionBar' }
</script>

<style lang="scss" scoped>
.option {
  padding: 14px;
  background: $surface;
  border: 1px solid $line;
  border-radius: 14px;
  /* 选中 / 按下时底色和描边渐变过去，避免勾选瞬间硬切 */
  transition:
    background-color $dur-fast $ease-both,
    border-color $dur-fast $ease-both,
    box-shadow $dur-fast $ease-both;

  &--active {
    background: $subtle;
  }

  /* 09/11：竖向，标题行 + 进度条，行距 8 */
  &--result {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* 10/12：52 高的单行，内边距只留左右 */
  &--locked {
    height: 52px;
    padding: 0 14px;
    display: flex;
    align-items: center;
  }

  /* 选中态：设计稿是 2px $accent 描边。
     用 1px border + 1px 内阴影叠成 2px，而不是把 border-width 改成 2 ——
     改 border-width 会让 border-box 的内容区缩 1px，勾选时整块文字轻微抖动。 */
  &--selected {
    background: $accent-soft;
    border-color: $accent;
    box-shadow: inset 0 0 0 1px $accent;
  }

  &__row {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  &__left {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  &--result &__left {
    gap: 7px;
  }

  &--locked &__left {
    gap: 10px;
  }

  /* 设计稿：20 的正圆，2px $line 描边，未选中时完全透明底 */
  &__mark {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid $line;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition:
      background-color $dur-fast $ease-both,
      border-color $dur-fast $ease-both,
      transform $dur-fast $ease-both;

    &--multi {
      border-radius: 6px;
    }

    &--on {
      border-color: $accent;
      background: $accent;
      /* 圆点轻轻涨一下，勾选有「按下去」的反馈 */
      transform: scale(1.06);
    }
  }

  &__check {
    animation-duration: $dur-fast;
  }

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__title {
    font-size: 15px;
    font-weight: 500;
    color: $ink;
    line-height: 1.4;
  }

  &--result &__title,
  &--locked &__title {
    font-size: 14px;
    font-weight: 400;
  }

  &--selected &__title {
    font-weight: 600;
  }

  &__desc {
    font-size: 11px;
    color: $faint;
    line-height: 1.4;
  }

  /* 07：行尾票数宽 76、右对齐；未选中 12/400/$muted，选中 12/600/$accent */
  &__value {
    flex: 0 0 76px;
    text-align: right;
    font-size: 12px;
    font-weight: 400;
    color: $muted;
    font-family: $font-num;
    transition: color $dur-fast $ease-both;
  }

  &--result &__value {
    flex: 0 0 auto;
    /* 09/11 已投票：票数无论选中与否都是 600，只有颜色区分（选中 $accent / 未选中 $muted） */
    font-weight: 600;
  }

  &--selected &__value {
    font-weight: 600;
    color: $accent;
  }

  &__track {
    height: 6px;
    border-radius: 3px;
    background: $line;
    overflow: hidden;
  }

  &__fill {
    height: 100%;
    border-radius: 3px;
    background: #d4d4d8;
    /* 进场由 .anim--grow 的 scaleX 负责，这里只管数值变化时的宽度过渡 */
    transition: width $dur-slow $ease-both;
  }

  &--selected &__fill {
    background: $accent;
  }
}
</style>
