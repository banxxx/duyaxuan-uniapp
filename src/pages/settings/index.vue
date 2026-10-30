<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppAvatar from '@/components/base/AppAvatar.vue'
import AppSheet from '@/components/base/AppSheet.vue'
import AppActionSheet from '@/components/base/AppActionSheet.vue'
import AppButton from '@/components/base/AppButton.vue'
import MenuRow from '@/components/business/MenuRow.vue'
import { useUserStore } from '@/stores/user'
import { fetchDevAccounts } from '@/api/auth'
import { useSettingsStore } from '@/stores/settings'
import { bottomInset } from '@/utils/platform'
import { ROUTES, go, reset } from '@/utils/router'

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
 *  换成和 40 一致的「加入 N 天」，两页对得上，也不用凭空造字段。
 *  用户 id 是内部标识，对用户没有意义，不往界面上放。 */
const meta = computed(() => {
  const at = user.profile?.createdAt
  const days = at ? Math.floor((Date.now() - at) / (24 * 3600 * 1000)) : 0
  // 刚注册的账号写「加入 0 天」很怪
  return days > 0 ? `加入 ${days} 天` : '今天加入'
})

/** 两个确认弹层 */
const sheet = ref<'logout' | 'cache' | null>(null)

/**
 * 开发工具：长按「关于我们」切换测试账号
 *
 * 后端 /auth/dev-login 只在 .dev.vars 配了 DEV_LOGIN=true 时存在，
 * 这里再用 import.meta.env.DEV 挡一层 —— 生产包里连请求都不会发。
 * 配合 npm run seed 灌入的账号，可以在一台设备上来回切发起人/参与者。
 */
const devVisible = ref(false)
const devAccounts = ref<Array<{ id: string; nickname?: string }>>([])
const devItems = computed(() =>
  devAccounts.value.map((a) => ({
    key: a.id,
    label: a.nickname || a.id,
    selected: a.id === user.profile?.id
  }))
)

async function openDevAccounts() {
  if (!import.meta.env.DEV) return
  const accounts = await fetchDevAccounts().catch(() => [])
  if (!accounts.length) {
    uni.showToast({ title: '没有可切换的测试账号', icon: 'none' })
    return
  }
  devAccounts.value = accounts
  devVisible.value = true
}

async function onDevAccount(id: string) {
  if (id === user.profile?.id) return
  try {
    await user.loginAs(id)
    reset(ROUTES.home)
  } catch {
    // 失败原因由请求层 toast
  }
}

onMounted(() => settings.restore())

function open(url: string) {
  go(url)
}

function confirmLogout() {
  user.logout()
  sheet.value = null
  reset(ROUTES.login)
}

function confirmClear() {
  const cleared = settings.clearCache()
  sheet.value = null
  uni.showToast({
    title: cleared === '0 KB' ? '没有可清理的缓存' : `已清除 ${cleared}`,
    icon: 'none'
  })
}

/** 缓存为 0 时换一句提示，避免出现「将清除 0 KB」这种别扭文案 */
const cacheDesc = computed(() =>
  settings.settings.cacheSize === '0 KB'
    ? '当前没有可清理的本地缓存。'
    : `将清除草稿、搜索历史等 ${settings.settings.cacheSize} 本地数据，不会影响账号和投票记录。`
)
</script>

<template>
  <view class="settings">
    <AppNavBar title="设置" />

    <scroll-view class="settings__scroll" scroll-y>
      <view class="settings__content" :style="{ paddingBottom: bottomInset(20) }">
        <!-- 个人信息 -->
        <view class="profile">
          <AppAvatar
            :src="user.profile?.avatar"
            :name="name"
            :seed="user.profile?.id"
            :size="52"
          />
          <view class="profile__info">
            <text class="profile__name">{{ name }}</text>
            <text class="profile__meta">{{ meta }}</text>
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
              @tap="open('/pages/settings/notifications?tab=push')"
            />
            <view class="group__sep" />
            <MenuRow title="账号与安全" icon="user-round" @tap="open('/pages/settings/account')" />
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
            <MenuRow title="帮助与反馈" icon="info" @tap="open('/pages/support/index')" />
            <view class="group__sep" />
            <MenuRow title="用户协议" icon="file-text" @tap="open('/pages/settings/doc?type=terms')" />
            <view class="group__sep" />
            <!-- 长按「关于我们」切换测试账号：只在开发构建里生效，线上没有这个后门 -->
            <view @longpress="openDevAccounts">
              <MenuRow
                title="关于我们"
                icon="info"
                :value="`v${version}`"
                @tap="open('/pages/settings/doc?type=about')"
              />
            </view>
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
        <view class="flex-1">
          <AppButton type="subtle" size="dialog" @tap="sheet = null">取消</AppButton>
        </view>
        <view class="flex-1">
          <AppButton type="danger" size="dialog" @tap="confirmLogout">退出登录</AppButton>
        </view>
      </view>
    </AppSheet>

    <!-- 56 清除缓存确认 -->
    <AppSheet
      :visible="sheet === 'cache'"
      variant="confirm"
      title="清除缓存？"
      :desc="cacheDesc"
      @close="sheet = null"
    >
      <view class="confirm-actions">
        <view class="flex-1">
          <AppButton type="subtle" size="dialog" @tap="sheet = null">取消</AppButton>
        </view>
        <view class="flex-1">
          <AppButton size="dialog" @tap="confirmClear">清除</AppButton>
        </view>
      </view>
    </AppSheet>

    <AppActionSheet
      :visible="devVisible"
      title="切换测试账号"
      :items="devItems"
      @close="devVisible = false"
      @select="onDevAccount"
    />
  </view>
</template>

<script lang="ts">
export default { name: 'SettingsPage' }
</script>

<style lang="scss" scoped>
.settings {
  /* 定高：scroll-view 需要父级有确定高度，min-height 在真机上会让它塌成 0 高 */
  height: 100vh;
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
