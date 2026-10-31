<script setup lang="ts">
import { ref } from 'vue'
import AppNavBar from '@/components/base/AppNavBar.vue'
import MixauthQr from '@/components/business/MixauthQr.vue'
import AppToast from '@/components/base/AppToast.vue'
import { useUserStore } from '@/stores/user'
import { bottomInset } from '@/utils/platform'
import { toast } from '@/utils/toast'
import type { MixauthProvider } from '@/api/mixauth'
import type { UserProfile } from '@/types/api'

/**
 * 绑定登录方式
 *
 * 已登录用户再扫一个 MixAuth 二维码，把这次扫码的身份追加到当前账号，
 * 之后用 QQ 或微信扫码都能进同一个账号、看到同一份数据。
 * 入口在「账号与安全」里，仅 H5 展示。
 */
const user = useUserStore()

const provider = ref<MixauthProvider>('wechat')
const visible = ref(false)

function openBind(p: MixauthProvider) {
  provider.value = p
  visible.value = true
}

function closeBind() {
  visible.value = false
}

function onSuccess(payload: { provider: MixauthProvider; user?: UserProfile }) {
  visible.value = false
  if (!payload.user) return
  user.applyProfile(payload.user)
  toast.success('绑定成功')
}
</script>

<template>
  <view class="bind">
    <AppToast />
    <AppNavBar title="绑定登录方式" />

    <scroll-view class="bind__scroll" scroll-y>
      <view class="bind__content" :style="{ paddingBottom: bottomInset(20) }">
        <text class="bind__lead">
          绑定后，用 QQ 或微信扫码都能登录同一个账号，发起和参与的数据互通。
        </text>

        <view class="bind__actions">
          <view class="bind__action" hover-class="bind__action--active" @tap="openBind('wechat')">
            <text class="bind__action-text">绑定微信登录</text>
          </view>
          <view
            class="bind__action bind__action--ghost"
            hover-class="bind__action--active"
            @tap="openBind('qq')"
          >
            <text class="bind__action-text bind__action-text--ink">绑定 QQ 登录</text>
          </view>
        </view>

        <text class="bind__note">扫码需要手机摄像头，建议在电脑上打开本页操作。</text>
      </view>
    </scroll-view>

    <MixauthQr
      :provider="provider"
      :visible="visible"
      mode="bind"
      @close="closeBind"
      @success="onSuccess"
    />
  </view>
</template>

<script lang="ts">
export default { name: 'BindPage' }
</script>

<style lang="scss" scoped>
.bind {
  height: 100vh;
  /* #ifdef H5 */
  height: 100dvh;
  /* #endif */
  background: $bg;
  display: flex;
  flex-direction: column;

  &__scroll {
    flex: 1;
    height: 0;
  }

  &__content {
    padding: 20px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  &__lead {
    font-size: $fs-13;
    color: $muted;
    line-height: 1.6;
  }

  &__actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  &__action {
    height: 54px;
    box-sizing: border-box;
    border-radius: $r-input;
    background: $accent;
    display: flex;
    align-items: center;
    justify-content: center;

    &--active {
      opacity: 0.88;
    }

    &--ghost {
      background: $surface;
      border: 1px solid $line;
    }
  }

  &__action-text {
    font-size: $fs-15;
    font-weight: 600;
    color: $white;

    &--ink {
      color: $ink;
    }
  }

  &__note {
    font-size: $fs-11;
    color: $faint;
    line-height: 1.5;
  }
}
</style>
