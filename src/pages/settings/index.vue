<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppAvatar from '@/components/base/AppAvatar.vue'
import AppSheet from '@/components/base/AppSheet.vue'
import AppButton from '@/components/base/AppButton.vue'
import MenuRow from '@/components/business/MenuRow.vue'
import { useUserStore } from '@/stores/user'
import { useSettingsStore } from '@/stores/settings'
import { bottomInset } from '@/utils/platform'

/**
 * 43 设置（含 49 退出登录确认、56 清除缓存确认）
 *
 * 两个确认弹窗都做成底部面板，和删除投票（92/95）保持同一套视觉：
 * 原生 showModal 的圆角和间距改不了，和整站风格对不上。
 *
 * 退出登录不单独做「已退出」页：清 token 后直接 reLaunch 到 01 登录。
 * 「检查更新」（57）在 48 关于我们里，不在这里重复放一行。
 */
const user = useUserStore()
const settings = useSettingsStore()

const version = '1.2.0'

const name = computed(() => user.profile?.nickname ?? '未登录')

/** 设计稿这里写的是「ID 1024 · 产品部」，但数据模型里没有部门字段，
 *  换成和 40 一致的「加入 N 天」，两页对得上，也不用凭空造字段。 */
const meta = computed(() => {
  const at = user.profile?.createdAt
  const days = at ? Math.floor((Date.now() - at) / (24 * 3600 * 1000)) : 0
  return `ID ${user.profile?.id ?? '-'} · 加入 ${days} 天`
})

/** 两个确认弹层 */
const sheet = ref<'logout' | 'cache' | null>(null)

onMounted(() => settings.restore())

function go(url: string) {
  uni.navigateTo({ url })
}

function confirmLogout() {
  user.logout()
  sheet.value = null
  uni.reLaunch({ url: '/pages/login/index' })
}

function confirmClear() {
  settings.clearCache()
  sheet.value = null
  uni.showToast({ title: '已清除', icon: 'none' })
}
</script>

<template>
  <view class="settings">
    <AppNavBar title="设置" />

    <scroll-view class="settings__scroll" scroll-y>
      <view class="settings__content" :style="{ paddingBottom: bottomInset(20) }">
        <!-- 个人信息 -->
        <view class="profile">
          <AppAvatar :src="user.profile?.avatar" :name="name" :size="52" />
          <view class="profile__info">
            <text class="profile__name">{{ name }}</text>
            <text class="profile__meta">{{ meta }}</text>
          </view>
          <view class="profile__edit" hover-class="profile__edit--active" @tap="go('/pages/settings/profile')">
            <text class="profile__edit-text">编辑</text>
          </view>
        </view>

        <!-- 账号 -->
        <view class="group">
          <text class="group__head">账号</text>
          <view class="group__card">
            <MenuRow
              title="推送通知"
              icon="bell"
              :value="settings.settings.pushEnabled ? '开启' : '已关闭'"
              @tap="go('/pages/settings/notifications?tab=push')"
            />
            <view class="group__sep" />
            <MenuRow title="账号与安全" icon="user-round" @tap="go('/pages/settings/account')" />
          </view>
        </view>

        <!-- 通用 -->
        <view class="group">
          <text class="group__head">通用</text>
          <view class="group__card">
            <MenuRow
              title="缓存"
              icon="database"
              :value="settings.settings.cacheSize"
              @tap="sheet = 'cache'"
            />
          </view>
        </view>

        <!-- 关于 -->
        <view class="group">
          <text class="group__head">关于</text>
          <view class="group__card">
            <MenuRow title="帮助与反馈" icon="info" @tap="go('/pages/support/index')" />
            <view class="group__sep" />
            <MenuRow title="用户协议" icon="file-text" @tap="go('/pages/settings/doc?type=terms')" />
            <view class="group__sep" />
            <MenuRow
              title="关于我们"
              icon="info"
              :value="`v${version}`"
              @tap="go('/pages/settings/doc?type=about')"
            />
          </view>
        </view>

        <!-- 退出 -->
        <view class="logout" hover-class="logout--active" @tap="sheet = 'logout'">
          <text class="logout__text">退出登录</text>
        </view>
      </view>
    </scroll-view>

    <!-- 49 退出登录确认 -->
    <AppSheet
      :visible="sheet === 'logout'"
      variant="confirm"
      title="确认退出登录？"
      desc="退出后需要重新授权登录才能查看你发起的投票和参与记录。"
      @close="sheet = null"
    >
      <view class="confirm-actions">
        <AppButton type="subtle" size="dialog" @tap="sheet = null">取消</AppButton>
        <AppButton type="danger" size="dialog" @tap="confirmLogout">退出登录</AppButton>
      </view>
    </AppSheet>

    <!-- 56 清除缓存确认 -->
    <AppSheet
      :visible="sheet === 'cache'"
      variant="confirm"
      title="清除缓存？"
      :desc="`将清除 ${settings.settings.cacheSize} 的图片与离线数据，不会影响你的投票记录。`"
      @close="sheet = null"
    >
      <view class="confirm-actions">
        <AppButton type="subtle" size="dialog" @tap="sheet = null">取消</AppButton>
        <AppButton size="dialog" @tap="confirmClear">清除</AppButton>
      </view>
    </AppSheet>

  </view>
</template>

<script lang="ts">
export default { name: 'SettingsPage' }
</script>

<style lang="scss" scoped>
.settings {
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
    gap: 18px;
  }
}

.profile {
  padding: 16px;
  border-radius: 16px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  gap: 12px;

  &__info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  &__name {
    font-size: 16px;
    font-weight: 700;
    color: $ink;
  }

  &__meta {
    font-size: 11px;
    color: $faint;
  }

  &__edit {
    padding: 6px 12px;
    border-radius: 8px;
    background: $subtle;
    display: flex;
    align-items: center;

    &--active {
      opacity: 0.8;
    }
  }

  &__edit-text {
    font-size: 11px;
    font-weight: 600;
    color: $ink;
  }
}

.group {
  display: flex;
  flex-direction: column;
  gap: 18px;

  &__head {
    font-size: 11px;
    font-weight: 600;
    color: $faint;
  }

  &__card {
    border-radius: 14px;
    background: $surface;
    border: 1px solid $line;
    overflow: hidden;
  }

  &__sep {
    height: 1px;
    background: $line;
  }
}

.logout {
  height: 48px;
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  justify-content: center;

  &--active {
    background: $subtle;
  }

  &__text {
    font-size: 14px;
    font-weight: 600;
    color: $danger;
  }
}

.confirm-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
