<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import { fetchMyPolls, fetchJoinedPolls } from '@/api/poll'
import { deleteAccount } from '@/api/auth'
import { useUserStore } from '@/stores/user'
import { bottomInset } from '@/utils/platform'
import { reset, ROUTES } from '@/utils/router'

/**
 * 53 注销账号
 *
 * 三个数字（我创建的 N 个投票 / 我的 M 条投票记录）都从真实接口取，
 * 写死数字会让用户在注销那一刻发现对不上，反而更不敢点。
 *
 * 密码输入是必填的：注销不可逆，至少多一道门槛。
 */
const user = useUserStore()

const createdCount = ref(0)
const joinedCount = ref(0)
const password = ref('')
const submitting = ref(false)

const canSubmit = computed(() => password.value.length > 0 && !submitting.value)

onMounted(async () => {
  try {
    const [mine, joined] = await Promise.all([fetchMyPolls('all'), fetchJoinedPolls('all')])
    createdCount.value = mine.total
    joinedCount.value = joined.total
  } catch {
    // 取不到就显示 0，不阻塞注销流程
  }
})

const items = computed(() => [
  { title: `我创建的 ${createdCount.value} 个投票`, desc: '将全部关闭并删除' },
  { title: `我的 ${joinedCount.value} 条投票记录`, desc: '将从参与者列表移除' },
  { title: '我的个人资料', desc: '昵称与头像将被清空' }
])

function submit() {
  if (!canSubmit.value) return
  uni.showModal({
    title: '确认注销账号？',
    content: '账号及全部数据将被永久删除，无法恢复。',
    confirmText: '确认注销',
    confirmColor: '#DC2626',
    success: async (r) => {
      if (!r.confirm) return
      submitting.value = true
      try {
        await deleteAccount(password.value)
        user.logout()
        reset(ROUTES.login)
      } catch {
        uni.showToast({ title: '密码不正确', icon: 'none' })
      } finally {
        submitting.value = false
      }
    }
  })
}
</script>

<template>
  <view class="deact">
    <AppNavBar title="注销账号" />

    <scroll-view class="deact__scroll" scroll-y>
      <view class="deact__content" :style="{ paddingBottom: bottomInset(20) }">
        <!-- 警告 -->
        <view class="warn">
          <view class="warn__icon">
            <AppIcon name="triangle-alert" :size="18" color="#DC2626" />
          </view>
          <view class="warn__text">
            <text class="warn__title">此操作不可恢复</text>
            <text class="warn__desc">注销后，你的账号、创建的投票、投票记录将被永久删除。</text>
          </view>
        </view>

        <text class="deact__group">注销前请确认</text>

        <view class="group">
          <template v-for="(item, i) in items" :key="item.title">
            <view v-if="i > 0" class="group__sep" />
            <view class="item">
              <AppIcon name="circle-check" :size="16" color="#047857" />
              <view class="item__text">
                <text class="item__title">{{ item.title }}</text>
                <text class="item__desc">{{ item.desc }}</text>
              </view>
            </view>
          </template>
        </view>

        <text class="deact__note">注销需要验证身份，请先输入登录密码。</text>

        <view class="pwd">
          <input
            v-model="password"
            class="pwd__input"
            type="password"
            password
            maxlength="20"
            placeholder="请输入登录密码"
            placeholder-class="pwd__ph"
          />
        </view>

        <AppButton size="compact" type="danger" :disabled="!canSubmit" :loading="submitting" @tap="submit">
          确认注销
        </AppButton>
      </view>
    </scroll-view>
  </view>
</template>

<script lang="ts">
export default { name: 'DeactivatePage' }
</script>

<style lang="scss" scoped>
.deact {
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

  &__group {
    font-size: 11px;
    font-weight: 600;
    color: $faint;
  }

  &__note {
    font-size: 11px;
    color: $faint;
    line-height: 1.6;
    padding: 0 2px;
  }
}

.warn {
  padding: 16px;
  border-radius: 14px;
  background: $danger-mist;
  display: flex;
  gap: 12px;
  align-items: flex-start;

  &__icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: $danger-soft;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  &__title {
    font-size: 14px;
    font-weight: 700;
    color: $danger;
  }

  &__desc {
    font-size: 11px;
    color: $muted;
    line-height: 1.55;
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

.item {
  padding: 13px 15px;
  display: flex;
  align-items: center;
  gap: 10px;

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__title {
    font-size: 13px;
    color: $ink;
  }

  &__desc {
    font-size: 11px;
    color: $faint;
  }
}

.pwd {
  padding: 14px 15px;
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;

  &__input {
    font-size: 14px;
    color: $ink;
    height: 20px;
  }

  &__ph {
    color: $faint;
    font-size: 14px;
  }
}
</style>
