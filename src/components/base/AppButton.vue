<script setup lang="ts">
import AppIcon from './AppIcon.vue'

/**
 * 主按钮
 *
 * 设计稿里三种形态：
 *   primary  紫底白字（确认投票 / 保存修改）
 *   subtle   浅灰底深字（取消 / 次要操作）
 *   danger   红底白字（删除）
 *
 * 尺寸跟着场景走，字号不是统一的：
 *   large    52 高、圆角 16、15/600 —— 登录、创建流程、结果页、数据页
 *   submit   52 高、圆角 16、16/700 —— 详情页底部的主操作（05-08/19/20/75）
 *   action   52 高、圆角 16、14/600 + 前置图标 —— 69/70/76 的白底描边按钮
 *   compact  48 高、圆角 14、15/600 —— 表单页的保存（50/51）
 *   medium   40 高、圆角 12、14/600 —— 行内小按钮
 */
withDefaults(
  defineProps<{
    type?: 'primary' | 'subtle' | 'ink' | 'danger' | 'ghost' | 'outline'
    size?: 'large' | 'submit' | 'cta' | 'action' | 'compact' | 'dialog' | 'inline' | 'medium'
    /** 左侧图标（lucide 名）：19/20/69/70/76 的按钮都带图标 */
    icon?: string
    /** 覆盖圆角：21 是 16，22 的并列按钮是 14 */
    radius?: number
    disabled?: boolean
    loading?: boolean
    block?: boolean
    /**
     * 微信开放能力：'share' 时用原生 button 触发分享面板。
     * 小程序不允许代码主动拉起分享，只能靠 open-type=share，所以「分享」类按钮必须走这里，
     * 否则点击只能弹 toast 引导，等于废按钮。
     */
    openType?: 'share'
  }>(),
  { type: 'primary', size: 'large', disabled: false, loading: false, block: true }
)

const emit = defineEmits<{ (e: 'tap'): void }>()

function onTap() {
  emit('tap')
}

/** 图标跟文字同色：实底按钮用白，浅底按钮用主文字色 */
const iconColor = (type: string) =>
  type === 'primary' || type === 'danger' || type === 'ink' ? '#FFFFFF' : '#09090B'
</script>

<template>
  <!-- 分享按钮必须用原生 button + open-type=share 才能拉起分享面板（H5 上退化为普通 view） -->
  <button
    v-if="openType === 'share'"
    class="btn"
    :class="[`btn--${type}`, `btn--${size}`, { 'btn--disabled': disabled || loading, 'btn--block': block }]"
    :style="radius ? { borderRadius: `${radius}px` } : undefined"
    :hover-class="disabled || loading ? 'none' : 'btn--active'"
    :disabled="disabled || loading"
    open-type="share"
  >
    <view v-if="loading" class="btn__spinner" />
    <AppIcon
      v-else-if="icon"
      :name="icon"
      :size="17"
      :color="iconColor(type)"
      :stroke-width="2"
    />
    <text class="btn__text"><slot /></text>
  </button>

  <view
    v-else
    class="btn"
    :class="[`btn--${type}`, `btn--${size}`, { 'btn--disabled': disabled || loading, 'btn--block': block }]"
    :style="radius ? { borderRadius: `${radius}px` } : undefined"
    :hover-class="disabled || loading ? 'none' : 'btn--active'"
    @tap="!disabled && !loading && onTap()"
  >
    <view v-if="loading" class="btn__spinner" />
    <AppIcon
      v-else-if="icon"
      :name="icon"
      :size="17"
      :color="iconColor(type)"
      :stroke-width="2"
    />
    <text class="btn__text"><slot /></text>
  </view>
</template>

<script lang="ts">
export default { name: 'AppButton' }
</script>

<style lang="scss" scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: $r-button;
  font-size: 15px;
  font-weight: 600;

  &--block {
    display: flex;
    width: 100%;
  }

  &--large {
    height: 52px;
  }

  /* 05-08/19/20：详情页的「确认投票」「分享投票」，16 号粗体 */
  &--submit {
    height: 52px;
    font-size: 16px;
    font-weight: 700;
  }

  /* 69/70/76：白底描边与分享按钮，14 号字 + 前置图标 */
  &--action {
    height: 52px;
    font-size: 14px;
    font-weight: 600;
    gap: 6px;
  }

  /* 21 的「分享给同事」：15/600，白底描边 */
  &--cta {
    height: 52px;
    font-size: 15px;
    font-weight: 600;
    gap: 8px;
  }

  /* 表单页的「保存」：设计稿 50/51 是 48 高、14 圆角 */
  &--compact {
    height: 48px;
    border-radius: 14px;
  }

  /* 33 弹层里的并列按钮：48 高、14 圆角、14/600 */
  &--inline {
    height: 48px;
    font-size: 14px;
    font-weight: 600;
  }

  /* 49/53/56/57 的弹层按钮：50 高、14 圆角、15/600 */
  &--dialog {
    height: 50px;
    border-radius: 14px;
  }

  &--medium {
    height: 40px;
    padding: 0 16px;
    font-size: 14px;
    border-radius: 12px;
  }

  &--primary {
    background: $accent;
    color: #fff;
  }

  &--subtle {
    background: $subtle;
    color: $ink;
  }

  /* 20 的「投票数据」、21 的「分享给同事」、70 的「我的提交」是白底描边，不是浅灰底 */
  &--subtle.btn--submit,
  &--subtle.btn--cta,
  &--subtle.btn--action {
    background: $surface;
    border: 1px solid $line;
  }

  &--danger {
    background: $danger;
    color: #fff;
  }

  /* 22/23 的「返回投票详情」：黑底白字，不跟主色抢视线 */
  &--ink {
    background: $ink;
    color: #fff;
  }

  &--ghost {
    background: transparent;
    color: $accent;
  }

  /* 33 的「取消」：白底 1px 描边、$muted 字 */
  &--outline {
    background: $surface;
    border: 1px solid $line;
    color: $muted;
  }

  /* 设计稿的禁用态不是「主色降透明度」，而是整块退回 $subtle + $faint 文字 */
  &--disabled {
    background: $subtle;
    border-color: transparent;
    color: $faint;
  }

  &--disabled &__spinner {
    border-color: rgba(161, 161, 170, 0.4);
    border-top-color: $faint;
  }

  &--active {
    opacity: 0.85;
  }

  &__text {
    line-height: 1;
  }

  &__spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-top-color: #fff;
    border-radius: 50%;
    animation: btn-spin 0.7s linear infinite;
  }
}

@keyframes btn-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
