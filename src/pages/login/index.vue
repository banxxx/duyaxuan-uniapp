<template>
  <view class="login" :style="{ paddingTop: `${statusBarHeight}px` }">
    <!-- 设计稿 01：Content 竖向 space_between，顶部 56 / 左右 32 / 底部 32 -->
    <view class="login__content">
      <view class="login__top">
        <view class="login__brand">
          <view class="login__mark">
            <AppIcon name="vote" :size="21" color="#FFFFFF" :stroke-width="2" />
          </view>
          <text class="login__name">投票吧</text>
        </view>

        <view class="login__hero">
          <text class="login__title">发起一个投票，三分钟收集所有人的意见</text>
          <text class="login__subtitle">创建、分享、实时看结果，不需要注册新账号</text>
        </view>

        <view class="login__features">
          <view class="login__feature">
            <view class="login__feature-icon">
              <AppIcon name="zap" :size="17" color="#4F46E5" />
            </view>
            <text class="login__feature-text">实时统计</text>
          </view>
          <view class="login__feature">
            <view class="login__feature-icon">
              <AppIcon name="shield-check" :size="17" color="#4F46E5" />
            </view>
            <text class="login__feature-text">匿名保护</text>
          </view>
          <view class="login__feature">
            <view class="login__feature-icon">
              <AppIcon name="link" :size="17" color="#4F46E5" />
            </view>
            <text class="login__feature-text">扫码即参与</text>
          </view>
        </view>
      </view>

      <view class="login__bottom">
        <view class="login__action" hover-class="login__action--active" @tap="onLogin">
          <view v-if="loading" class="login__spinner" />
          <text class="login__action-text">{{ buttonText }}</text>
        </view>
        <view class="login__terms">
          <text class="login__terms-pre">登录即表示同意</text>
          <text class="login__link" @tap="openDoc('terms')">《用户协议》</text>
          <text class="login__terms-pre">与</text>
          <text class="login__link" @tap="openDoc('privacy')">《隐私政策》</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import AppIcon from '@/components/base/AppIcon.vue'
import { useUserStore } from '@/stores/user'
import { getPlatform, getSafeArea } from '@/utils/platform'
import { ROUTES, go, switchTab } from '@/utils/router'

/**
 * 01 登录 · 授权
 *
 * 微信 / QQ / 抖音都只有一颗主按钮，文案随宿主变。
 * QQ 复用微信包，所以这里必须靠运行时 platform 判断，不能用条件编译。
 *
 * 设计稿只画了「微信一键登录」实底 + 「QQ 一键登录」描边两颗，
 * 是因为两张图并排展示；实现时按宿主只渲染当前平台那一颗主按钮。
 */
const user = useUserStore()
const loading = ref(false)

/** 状态栏高度只取一次，模板里不直接调 uni API */
const { statusBarHeight } = getSafeArea()

const platform = getPlatform()
const buttonText = computed(() => {
  switch (platform) {
    case 'qq':
      return 'QQ 一键登录'
    case 'toutiao':
      return '抖音一键登录'
    default:
      return '微信一键登录'
  }
})

async function onLogin() {
  if (loading.value) return
  loading.value = true
  try {
    await user.login()
    // 首页是 tab 页：switchTab 会关掉登录页并复用首页实例
    switchTab(ROUTES.home)
  } catch (e) {
    uni.showToast({ title: '登录失败，请重试', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function openDoc(type: 'terms' | 'privacy') {
  go(ROUTES.settingsDoc, { type })
}
</script>

<script lang="ts">
export default { name: 'LoginPage' }
</script>

<style lang="scss" scoped>
.login {
  min-height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  &__content {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 0 32px 32px;
  }

  &__top {
    display: flex;
    flex-direction: column;
    gap: 40px;
    padding-top: 56px;
  }

  /* Brand：40 的紫色方块 + 17/bold 站名 */
  &__brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  &__mark {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: $accent;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__name {
    font-size: 17px;
    font-weight: 700;
    color: $ink;
  }

  &__hero {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  &__title {
    font-size: 28px;
    font-weight: 700;
    color: $ink;
    line-height: 1.35;
  }

  &__subtitle {
    font-size: 13px;
    color: $muted;
    line-height: 1.6;
  }

  &__features {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  &__feature {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  &__feature-icon {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    background: $accent-soft;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__feature-text {
    font-size: 14px;
    color: $ink;
  }

  &__bottom {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* 主按钮：54 高、14 圆角、15/600 */
  &__action {
    height: 54px;
    border-radius: 14px;
    background: $accent;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;

    &--active {
      opacity: 0.88;
    }
  }

  &__action-text {
    font-size: 15px;
    font-weight: 600;
    color: #fff;
  }

  &__spinner {
    width: 15px;
    height: 15px;
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-top-color: #fff;
    border-radius: 50%;
    animation: login-spin 0.7s linear infinite;
  }

  &__terms {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
  }

  &__terms-pre {
    font-size: 11px;
    color: $faint;
  }

  &__link {
    font-size: 11px;
    font-weight: 600;
    color: $accent-ink;
  }
}

@keyframes login-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
