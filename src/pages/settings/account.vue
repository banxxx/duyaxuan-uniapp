<script setup lang="ts">
import { computed } from 'vue'
import AppNavBar from '@/components/base/AppNavBar.vue'
import MenuRow from '@/components/business/MenuRow.vue'
import { useUserStore } from '@/stores/user'
import { getPlatform, bottomInset } from '@/utils/platform'
import { go } from '@/utils/router'
import AppToast from '@/components/base/AppToast.vue'

/**
 * 46 账号与安全
 *
 * 两个入口：平台授权（53/54）和注销账号。
 * 修改密码、手机号已经去掉 —— 登录完全依赖平台授权，不再有独立的凭据要维护。
 *
 * 「微信授权」这行的文案跟宿主走——QQ 包跑在 QQ 里时显示「QQ 授权」，
 * 抖音里显示「抖音授权」，否则用户会以为自己绑错了账号。
 *
 * H5 没有宿主，扫码时用的是微信还是 QQ 存在 user.authProvider 里。
 */
const user = useUserStore()

const isH5 = getPlatform() === 'h5'

const platformName = computed(() => {
  if (getPlatform() === 'h5') {
    if (user.authProvider === 'qq') return 'QQ 授权'
    if (user.authProvider === 'weixin') return '微信授权'
    return '账号授权'
  }
  switch (getPlatform()) {
    case 'qq':
      return 'QQ 授权'
    case 'toutiao':
      return '抖音授权'
    default:
      return '微信授权'
  }
})

const bindDesc = computed(() => {
  const name = user.profile?.nickname ?? '-'
  return user.profile?.bound ? `已绑定 · ${name}` : '未绑定'
})

function open(url: string) {
  go(url)
}
</script>

<template>
  <view class="account">
    <AppToast />
    <AppNavBar title="账号与安全" />

    <scroll-view class="account__scroll" scroll-y>
      <view class="account__content" :style="{ paddingBottom: bottomInset(20) }">
        <view class="group">
          <MenuRow :title="platformName" :desc="bindDesc" roomy strong @tap="open('/pages/settings/wechat')" />
        </view>

        <!-- H5：扫码登录可以绑多个平台，这里提供追加绑定入口 -->
        <view v-if="isH5" class="group">
          <MenuRow
            title="绑定其他登录方式"
            desc="让 QQ / 微信扫码进入同一个账号"
            roomy
            strong
            @tap="open('/pages/settings/bind')"
          />
        </view>

        <view class="group">
          <MenuRow
            title="注销账号"
            desc="删除账号与你发起的投票"
            roomy
            strong
            @tap="open('/pages/settings/deactivate')"
          />
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script lang="ts">
export default { name: 'AccountPage' }
</script>

<style lang="scss" scoped>
.account {
  /* 定高：scroll-view 需要父级有确定高度，min-height 在真机上会让它塌成 0 高 */
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
    /* 下边距由 bottomInset(20) 内联控制 */
    padding: 8px $gutter 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
}

.group {
  border-radius: $r-button;
  background: $surface;
  border: 1px solid $line;
  overflow: hidden;

  &__sep {
    height: 1px;
    background: $line;
  }
}
</style>
