<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import AppSheet from './AppSheet.vue'
import AppButton from './AppButton.vue'
import AppIcon from './AppIcon.vue'
import {
  INVITE_CODE_LENGTH,
  extractInviteCode,
  isValidInviteCode,
  normalizeInviteCode
} from '@/utils/invite'

/**
 * 邀请码输入弹层
 *
 * 和 AppConfirmSheet 同一套 confirm 骨架：上沿 24 圆角、标题 17/700、
 * 底部两个 50 高按钮。中间换成 6 个独立格子 —— 输入框本身放到屏幕外，
 * 点击格子时再让它聚焦。这样既有「一格一个字符」的观感，
 * 又不会露出原生输入框那个和格子对不齐的光标。
 *
 * 键盘处理：
 *   - adjust-position=false：键盘弹起时不要滚整个页面，否则背景会整体上移
 *   - 监听键盘高度，把面板整体抬起来，保证「取消 / 进入」不被键盘盖住
 *
 * 错误处理：
 *   - 格式不对 / 校验失败都只给一句概括提示，并让整排格子抖一下
 *   - 校验由页面侧完成（小程序端不能把函数当 props 传），
 *     结果通过 validating / error 两个 props 回传，弹层不关闭
 */
const props = withDefaults(
  defineProps<{
    visible: boolean
    /** 重新输入时带回上一次的值 */
    initial?: string
    /** 页面正在校验邀请码 */
    validating?: boolean
    /** 上一次校验失败的原因 */
    error?: string
    /** 失败次数：文案相同也能重新抖动 */
    errorSeq?: number
  }>(),
  { initial: '', validating: false, error: '', errorSeq: 0 }
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', code: string): void
}>()

const value = ref('')
const focused = ref(false)
const shaking = ref(false)
/** 本地校验错误；页面校验失败时由 props.error 带进来 */
const localError = ref('')

/** 键盘高度：面板据此整体抬高，避免按钮被盖住 */
const keyboardHeight = ref(0)
let keyboardHandler: ((res: { height: number }) => void) | null = null
let shakeTimer: ReturnType<typeof setTimeout> | null = null
let focusTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.visible,
  (visible) => {
    if (focusTimer) {
      clearTimeout(focusTimer)
      focusTimer = null
    }
    if (!visible) {
      shaking.value = false
      return
    }
    value.value = normalizeInviteCode(props.initial)
    localError.value = ''
    shaking.value = false
    focused.value = false

    // 等进场动画播完再唤起键盘：弹层还在上滑时弹键盘会打架
    focusTimer = setTimeout(() => {
      focused.value = true
      focusTimer = null
    }, 260)
  },
  { immediate: true }
)

/**
 * 页面校验失败（errorSeq 递增）：
 * 留在原地提示 + 抖动，不关闭弹层。文案相同也能重新抖一次。
 */
watch(
  () => props.errorSeq,
  () => {
    if (props.error) {
      localError.value = props.error
      shake()
    }
  }
)

onMounted(() => {
  if (typeof uni.onKeyboardHeightChange !== 'function') return
  keyboardHandler = (res) => {
    keyboardHeight.value = res.height
  }
  uni.onKeyboardHeightChange(keyboardHandler)
})

onUnmounted(() => {
  if (keyboardHandler && typeof uni.offKeyboardHeightChange === 'function') {
    uni.offKeyboardHeightChange(keyboardHandler)
  }
  if (shakeTimer) clearTimeout(shakeTimer)
  if (focusTimer) clearTimeout(focusTimer)
})

const message = computed(() => {
  if (localError.value) return localError.value
  // 输满 6 位但不是合法字符（比如中文、0/1/I/O）时给一句概括提示
  if (value.value.length === INVITE_CODE_LENGTH && !isValidInviteCode(value.value)) {
    return '邀请码不正确，请重新输入'
  }
  return ''
})

const canSubmit = computed(() => isValidInviteCode(value.value))

/** 6 个格子各自的字符，空位是空串 */
const cells = computed(() =>
  Array.from({ length: INVITE_CODE_LENGTH }, (_, i) => value.value[i] ?? '')
)

function onInput(e: Event) {
  // 小程序 input 的事件对象带 detail.value；H5 的类型声明里没有，这里取一次
  const detail = (e as unknown as { detail?: { value?: string } }).detail
  value.value = normalizeInviteCode(detail?.value ?? '')
  localError.value = ''
}

/** 输入框在屏幕外，点格子时让它聚焦；已经聚焦就不重复触发 */
function focusInput() {
  if (!focused.value) focused.value = true
}

/** 取消 / 点遮罩：先收键盘，再关闭弹层 */
function onCancel() {
  if (focusTimer) {
    clearTimeout(focusTimer)
    focusTimer = null
  }
  focused.value = false
  uni.hideKeyboard()
  emit('close')
}

/**
 * 从剪贴板取邀请码。
 *
 * 输入框在屏幕外、没有原生光标，长按粘贴用不了，所以单独给一个「粘贴」按钮。
 * 用户可能只复制了码，也可能复制了「邀请码：TEA238」这种整句，尽量把码找出来。
 */
function onPaste() {
  uni.getClipboardData({
    success: (res) => {
      const code = extractInviteCode(res.data ?? '')
      if (!code) {
        localError.value = '剪贴板里没有可用的邀请码'
        shake()
        return
      }
      value.value = code
      localError.value = ''
      focused.value = true
    },
    fail: () => {
      localError.value = '读取剪贴板失败，请手动输入'
      shake()
    }
  })
}

/** 整排格子抖一下；连续报错也能重新播放 */
function shake() {
  shaking.value = false
  nextTick(() => {
    shaking.value = true
  })
  if (shakeTimer) clearTimeout(shakeTimer)
  shakeTimer = setTimeout(() => {
    shaking.value = false
    shakeTimer = null
  }, 420)
}

function onSubmit() {
  if (props.validating) return

  if (!canSubmit.value) {
    localError.value = '邀请码不正确，请重新输入'
    shake()
    return
  }

  // 交给页面校验（joinPoll）；失败时页面把 error 写回来，弹层不关闭
  emit('submit', value.value)
}
</script>

<template>
  <AppSheet
    :visible="visible"
    :bottom-offset="keyboardHeight"
    :mask-closable="!validating"
    variant="confirm"
    title="输入邀请码"
    desc="只对受邀的人开放，请先获取 6 位邀请码"
    @close="onCancel"
  >
    <view class="code">
      <view class="code__cells" :class="{ 'code__cells--shake': shaking }" @tap="focusInput">
        <view
          v-for="(char, i) in cells"
          :key="i"
          class="code__cell"
          :class="{
            'code__cell--filled': !!char,
            'code__cell--active': value.length === i,
            'code__cell--error': !!message
          }"
        >
          <text class="code__char">{{ char }}</text>
        </view>

        <!--
          输入框放到屏幕外：原生光标既藏不干净、又和格子对不齐，
          干脆让它不可见。点格子时通过 focus 属性把它聚焦起来。
        -->
        <input
          class="code__input"
          :value="value"
          :focus="focused"
          :adjust-position="false"
          :hold-keyboard="true"
          :maxlength="INVITE_CODE_LENGTH"
          type="text"
          confirm-type="done"
          :cursor-spacing="24"
          @input="onInput"
          @focus="focused = true"
          @blur="focused = false"
          @confirm="onSubmit"
        />
      </view>

      <view class="code__foot">
        <text v-if="message" class="code__error">{{ message }}</text>
        <text v-else class="code__hint">6 位字母或数字，不区分大小写</text>

        <!-- 输入框在屏幕外，没有原生光标可用，粘贴单独给一个入口 -->
        <view class="code__paste" hover-class="code__paste--active" @tap="onPaste">
          <AppIcon name="copy" :size="12" color="#4338CA" :stroke-width="2" />
          <text class="code__paste-text">粘贴</text>
        </view>
      </view>
    </view>

    <template #footer>
      <view class="actions">
        <view class="actions__btn">
          <AppButton type="subtle" size="dialog" :disabled="validating" @tap="onCancel">
            取消
          </AppButton>
        </view>
        <view class="actions__btn">
          <AppButton size="dialog" :disabled="!canSubmit" :loading="validating" @tap="onSubmit">
            进入
          </AppButton>
        </view>
      </view>
    </template>
  </AppSheet>
</template>

<script lang="ts">
export default { name: 'AppInviteCode' }
</script>

<style lang="scss" scoped>
.code {
  padding-top: 4px;

  &__cells {
    position: relative;
    display: flex;
    gap: 8px;

    &--shake {
      animation: code-shake 0.4s $ease-both;
    }
  }

  /* 和表单输入框同一套：14 圆角、白底、$line 描边 */
  &__cell {
    flex: 1;
    height: 56px;
    border-radius: $r-input;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      border-color $dur-fast $ease-both,
      background-color $dur-fast $ease-both;

    /* 已输入的格子用品牌浅色打底，扫一眼就知道输到第几位 */
    &--filled {
      background: $accent-soft;
      border-color: $accent-200;
    }

    /* 当前待输入的格子：和表单聚焦态一致 */
    &--active {
      border-color: $accent;
      box-shadow: inset 0 0 0 1px $accent;
    }

    &--error {
      border-color: $danger;
      background: $danger-mist;
    }
  }

  &__char {
    font-family: $font-num;
    font-size: $fs-22;
    font-weight: 700;
    color: $ink;
    line-height: 1;
  }

  /* 屏幕外：只负责接键盘输入，不参与视觉 */
  &__input {
    position: absolute;
    left: -999px;
    top: 0;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  &__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 10px;
    min-height: 18px;
  }

  &__hint,
  &__error {
    flex: 1;
    min-width: 0;
    font-size: $fs-11;
    line-height: 1.4;
  }

  &__hint {
    color: $faint;
  }

  &__error {
    color: $danger;
  }

  /* 右侧「粘贴」：小号文字按钮，不抢输入区的视线 */
  &__paste {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
    padding: 2px 0;
    transition: opacity $dur-fast $ease-both;

    &--active {
      opacity: 0.6;
    }
  }

  &__paste-text {
    font-size: $fs-11;
    font-weight: 600;
    color: $accent-ink;
  }
}

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 22px;

  &__btn {
    flex: 1;
  }
}

@keyframes code-shake {
  0%,
  100% {
    transform: translateX(0);
  }
  20% {
    transform: translateX(-6px);
  }
  40% {
    transform: translateX(6px);
  }
  60% {
    transform: translateX(-4px);
  }
  80% {
    transform: translateX(4px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .code__cells--shake {
    animation: none;
  }
}
</style>
