<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppButton from '@/components/base/AppButton.vue'
import { sendSmsCode, changePhone } from '@/api/auth'
import { useUserStore } from '@/stores/user'
import { bottomInset } from '@/utils/platform'
import { reset, ROUTES } from '@/utils/router'

/**
 * 51 更换手机号
 *
 * 验证码倒计时从后端返回的 cooldown 起算，不在前端写死 60——
 * 服务端限流多少秒，按钮就停多少秒，两边不会打架。
 *
 * 换号成功后原手机号不能登录了，所以这里强制重新登录：
 * 后端会作废当前 token，前端留着也没用。
 *
 * 注意不要先 applyProfile 再 logout——logout 会把 profile 一起清掉，
 * 顺序反了会先闪一下新号再跳登录页，没有意义。
 */
const user = useUserStore()

const phone = ref('')
const code = ref('')
const sending = ref(false)
const saving = ref(false)
const cooldown = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

const PHONE_RE = /^1[3-9]\d{9}$/

const phoneError = computed(() => {
  if (!phone.value) return ''
  return PHONE_RE.test(phone.value) ? '' : '手机号格式不正确'
})

const canSend = computed(() => PHONE_RE.test(phone.value) && cooldown.value === 0 && !sending.value)
const canSave = computed(() => PHONE_RE.test(phone.value) && /^\d{6}$/.test(code.value) && !saving.value)

const sendText = computed(() => (cooldown.value > 0 ? `${cooldown.value}s 后重发` : '获取验证码'))

function startCooldown(seconds: number) {
  cooldown.value = seconds
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    cooldown.value -= 1
    if (cooldown.value <= 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }, 1000)
}

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

async function send() {
  if (!canSend.value) return
  sending.value = true
  try {
    const { cooldown: s } = await sendSmsCode(phone.value)
    startCooldown(s)
    uni.showToast({ title: '验证码已发送', icon: 'none' })
  } catch {
    uni.showToast({ title: '发送失败，请稍后重试', icon: 'none' })
  } finally {
    sending.value = false
  }
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    await changePhone(phone.value, code.value)
    uni.showToast({ title: '手机号已更换', icon: 'none' })
    // 后端已作废 token，本地登录态一起清掉，回登录页用新号重新授权
    setTimeout(() => {
      user.logout()
      reset(ROUTES.login)
    }, 800)
  } catch {
    uni.showToast({ title: '验证码不正确', icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="phone">
    <AppNavBar title="更换手机号" />

    <scroll-view class="phone__scroll" scroll-y>
      <view class="phone__content" :style="{ paddingBottom: bottomInset(20) }">
        <view class="group">
          <view class="field">
            <text class="field__label">新手机号</text>
            <input
              v-model="phone"
              class="field__input"
              type="number"
              maxlength="11"
              placeholder="请输入新的手机号"
              placeholder-class="field__ph"
            />
          </view>

          <view class="group__sep" />

          <view class="field field--row">
            <view class="field__main">
              <text class="field__label">验证码</text>
              <input
                v-model="code"
                class="field__input"
                type="number"
                maxlength="6"
                placeholder="请输入 6 位短信验证码"
                placeholder-class="field__ph"
              />
            </view>
            <text
              class="field__send"
              :class="{ 'field__send--off': !canSend }"
              @tap="send"
            >
              {{ sendText }}
            </text>
          </view>
        </view>

        <text v-if="phoneError" class="phone__error">{{ phoneError }}</text>
        <text class="phone__note">更换后，原手机号将无法登录，请使用新手机号重新登录。</text>

        <AppButton size="compact" :disabled="!canSave" :loading="saving" @tap="save">保存</AppButton>
      </view>
    </scroll-view>
  </view>
</template>

<script lang="ts">
export default { name: 'PhonePage' }
</script>

<style lang="scss" scoped>
.phone {
  min-height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  &__scroll {
    flex: 1;
    height: 0;
  }

  &__content {
    /* 下边距由 bottomInset(20) 内联控制 */
    padding: 8px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  &__error {
    font-size: 11px;
    color: $danger;
    padding: 0 2px;
  }

  &__note {
    font-size: 11px;
    color: $faint;
    line-height: 1.6;
    padding: 0 2px;
  }
}

.group {
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;
  overflow: hidden;

  &__sep {
    height: 1px;
    background: $line;
  }
}

.field {
  padding: 14px 15px;
  display: flex;
  flex-direction: column;
  gap: 6px;

  &--row {
    flex-direction: row;
    align-items: center;
    gap: 10px;
  }

  &__main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  &__label {
    font-size: 11px;
    font-weight: 600;
    color: $faint;
  }

  &__input {
    font-size: 15px;
    color: $ink;
    height: 22px;
  }

  &__ph {
    color: $faint;
    font-size: 15px;
  }

  &__send {
    font-size: 13px;
    font-weight: 600;
    color: $accent-ink;
    flex-shrink: 0;

    &--off {
      color: $faint;
    }
  }
}
</style>
