<script setup lang="ts">
import { ref, computed } from 'vue'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppButton from '@/components/base/AppButton.vue'
import { changePassword } from '@/api/auth'
import { bottomInset } from '@/utils/platform'

/**
 * 50 修改密码
 *
 * 校验规则写死在客户端（8–20 位、字母 + 数字），和后端保持一致；
 * 这里只做「能不能点保存」的判断，具体错在哪等后端返回更准。
 *
 * 改完密码后端会作废其他设备的 token，本机不用重新登录。
 */
const oldPwd = ref('')
const newPwd = ref('')
const saving = ref(false)

/** 8–20 位，必须同时含字母和数字 */
const NEW_PWD_RE = /^(?=.*[A-Za-z])(?=.*\d)[\s\S]{8,20}$/

const newPwdError = computed(() => {
  if (!newPwd.value) return ''
  return NEW_PWD_RE.test(newPwd.value) ? '' : '需 8–20 位，且同时包含字母与数字'
})

const canSave = computed(
  () => !!oldPwd.value && NEW_PWD_RE.test(newPwd.value) && oldPwd.value !== newPwd.value
)

async function save() {
  if (!canSave.value || saving.value) return
  saving.value = true
  try {
    await changePassword(oldPwd.value, newPwd.value)
    uni.showToast({ title: '密码已修改', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 600)
  } catch {
    uni.showToast({ title: '原密码不正确', icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="pwd">
    <AppNavBar title="修改密码" />

    <scroll-view class="pwd__scroll" scroll-y>
      <view class="pwd__content" :style="{ paddingBottom: bottomInset(20) }">
        <view class="group">
          <view class="field">
            <text class="field__label">原密码</text>
            <input
              v-model="oldPwd"
              class="field__input"
              type="password"
              password
              maxlength="20"
              placeholder="请输入当前密码"
              placeholder-class="field__ph"
            />
          </view>

          <view class="group__sep" />

          <view class="field">
            <text class="field__label">新密码</text>
            <input
              v-model="newPwd"
              class="field__input"
              type="password"
              password
              maxlength="20"
              placeholder="8–20 位，需包含字母与数字"
              placeholder-class="field__ph"
            />
          </view>
        </view>

        <text v-if="newPwdError" class="pwd__error">{{ newPwdError }}</text>
        <text class="pwd__note">修改成功后，其他设备的登录状态将失效，需要重新登录。</text>

        <AppButton size="compact" :disabled="!canSave" :loading="saving" @tap="save">保存</AppButton>
      </view>
    </scroll-view>
  </view>
</template>

<script lang="ts">
export default { name: 'PasswordPage' }
</script>

<style lang="scss" scoped>
.pwd {
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
}
</style>
