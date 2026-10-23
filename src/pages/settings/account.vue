<script setup lang="ts">
import { computed } from 'vue'
import AppNavBar from '@/components/base/AppNavBar.vue'
import MenuRow from '@/components/business/MenuRow.vue'
import { useUserStore } from '@/stores/user'
import { getPlatform, bottomInset } from '@/utils/platform'
import { go } from '@/utils/router'

/**
 * 46 账号与安全
 *
 * 四行入口，各自一页（50 修改密码 / 51 更换手机号 / 54 授权 / 53 注销）。
 * 不塞弹层：修改密码、换手机号都是多字段表单，弹层里键盘一顶就没地方了。
 *
 * 「微信授权」这行的文案跟宿主走——QQ 包跑在 QQ 里时显示「QQ 授权」，
 * 抖音里显示「抖音授权」，否则用户会以为自己绑错了账号。
 */
const user = useUserStore()

const platformName = computed(() => {
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

const phoneDesc = computed(() => user.profile?.phone || '未绑定')

function open(url: string) {
  go(url)
}
</script>

<template>
  <view class="account">
    <AppNavBar title="账号与安全" />

    <scroll-view class="account__scroll" scroll-y>
      <view class="account__content" :style="{ paddingBottom: bottomInset(20) }">
        <view class="group">
          <MenuRow :title="platformName" :desc="bindDesc" roomy strong @tap="open('/pages/settings/wechat')" />
          <view class="group__sep" />
          <MenuRow title="手机号" :desc="phoneDesc" roomy strong @tap="open('/pages/settings/phone')" />
        </view>

        <view class="group">
          <MenuRow title="修改密码" roomy strong @tap="open('/pages/settings/password')" />
          <view class="group__sep" />
          <MenuRow
            title="注销账号"
            desc="永久删除账号及全部数据"
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
}

.group {
  border-radius: 16px;
  background: $surface;
  border: 1px solid $line;
  overflow: hidden;

  &__sep {
    height: 1px;
    background: $line;
  }
}
</style>
