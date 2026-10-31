<template>
  <view v-if="visible" class="mixauth" @tap="close">
    <view class="mixauth__card" @tap.stop>
      <text class="mixauth__title">{{ titleText }}</text>
      <text class="mixauth__desc">{{ descText }}</text>

      <view class="mixauth__qr" @tap="refresh">
        <image
          v-if="qrCode"
          class="mixauth__qr-img"
          :src="qrCode"
          mode="aspectFit"
          @error="onQrImageError"
        />
        <view v-else class="mixauth__qr-loading">
          <view class="mixauth__spinner" />
        </view>

        <!-- 已扫码：盖住二维码等手机端确认，确认成功前弹窗不关 -->
        <view v-if="isScanned" class="mixauth__mask">
          <view class="mixauth__spinner" />
          <text class="mixauth__mask-text">已扫码</text>
          <text class="mixauth__mask-action">请在手机上确认登录</text>
        </view>
        <view v-else-if="isStale" class="mixauth__mask">
          <text class="mixauth__mask-text">{{ staleText }}</text>
          <text class="mixauth__mask-action">点击刷新</text>
        </view>
      </view>

      <text class="mixauth__state">{{ stateText }}</text>
      <text class="mixauth__tip">微信 / QQ 扫码需要手机摄像头，建议在电脑上打开本页</text>
      <text class="mixauth__cancel" @tap="close">取消</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import type { UserProfile } from '@/types/api'
import type { MixauthProvider } from '@/api/mixauth'
import { useMixauthQr } from '@/composables/useMixauthQr'

/**
 * 扫码弹层：登录和绑定共用。
 *
 * 两种模式只差在调哪两个接口、成功后回调里带不带 token：
 *   login → /auth/mixauth/*（登录并签 token）
 *   bind  → /user/bind/*  （把扫码身份绑到当前账号，带 token 自动注入）
 *
 * 轮询状态机在 useMixauthQr 里。
 */
const props = withDefaults(
  defineProps<{
    provider: MixauthProvider
    visible: boolean
    mode?: 'login' | 'bind'
  }>(),
  { mode: 'login' }
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'success', payload: { provider: MixauthProvider; token?: string; user?: UserProfile }): void
}>()

const providerName = computed(() => (props.provider === 'qq' ? 'QQ' : '微信'))
const titleText = computed(() =>
  props.mode === 'bind' ? `绑定 ${providerName.value} 登录` : `${providerName.value} 扫码登录`
)
const descText = computed(() =>
  props.mode === 'bind'
    ? `使用手机 ${providerName.value} 扫一扫，绑定到当前账号`
    : `请使用手机 ${providerName.value} 扫一扫`
)

const { qrCode, isScanned, isStale, stateText, staleText, start, stop, refresh, onQrImageError } =
  useMixauthQr({
    provider: () => props.provider,
    mode: () => props.mode,
    isActive: () => props.visible,
    onSuccess: (payload) => emit('success', payload)
  })

watch(
  () => props.visible,
  (v) => {
    if (v) start()
    else stop()
  }
)

function close() {
  emit('close')
}
</script>

<style lang="scss" scoped>
.mixauth {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 500;
  background: rgba(9, 9, 11, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 32px;

  &__card {
    width: 100%;
    max-width: 320px;
    background: $surface;
    border-radius: $r-card;
    box-shadow: $shadow-float;
    padding: 24px 20px 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  &__title {
    font-size: $fs-17;
    font-weight: 700;
    color: $ink;
  }

  &__desc {
    margin-top: 6px;
    font-size: $fs-12;
    color: $muted;
  }

  &__qr {
    position: relative;
    width: 180px;
    height: 180px;
    margin-top: 20px;
    border-radius: $r-md;
    border: 1px solid $line;
    background: $white;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__qr-img {
    width: 100%;
    height: 100%;
  }

  &__qr-loading {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__spinner {
    width: 22px;
    height: 22px;
    border: 2px solid $line;
    border-top-color: $accent;
    border-radius: 50%;
    animation: mixauth-spin 0.7s linear infinite;
  }

  &__mask {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    background: rgba(255, 255, 255, 0.92);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  &__mask-text {
    font-size: $fs-12;
    color: $muted;
  }

  &__mask-action {
    font-size: $fs-13;
    font-weight: 600;
    color: $accent-ink;
  }

  &__state {
    margin-top: 14px;
    font-size: $fs-13;
    font-weight: 600;
    color: $ink;
  }

  &__tip {
    margin-top: 6px;
    font-size: $fs-11;
    line-height: 1.5;
    color: $faint;
  }

  &__cancel {
    margin-top: 14px;
    padding: 4px 12px;
    font-size: $fs-13;
    color: $muted;
  }
}

@keyframes mixauth-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
