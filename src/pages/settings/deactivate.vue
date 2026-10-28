<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSheet from '@/components/base/AppSheet.vue'
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
 * 二次确认用 AppSheet 而不是原生 showModal：圆角和间距和整站一致，
 * 和 43 的「退出登录确认」「清除缓存确认」是同一套视觉。
 * 以前这里是输密码确认，现在登录只依赖平台授权、没有密码可验，所以改成弹窗。
 */
const user = useUserStore()

const createdCount = ref(0)
const joinedCount = ref(0)
const confirming = ref(false)
const submitting = ref(false)

const canSubmit = computed(() => !submitting.value)

onMounted(async () => {
  try {
    const [mine, joined] = await Promise.all([fetchMyPolls('all'), fetchJoinedPolls('all')])
    createdCount.value = mine.total
    joinedCount.value = joined.total
  } catch {
    // 取不到就显示 0，不阻塞注销流程
  }
})

/**
 * 这三条要和服务端实际做的事对得上：
 * 发起的投票软删除；投票记录只清身份、不删记录（删了会让别人看到的百分比凭空变化）；
 * 账号本身打注销标记并清空昵称头像。
 */
const items = computed(() => [
  { title: `我创建的 ${createdCount.value} 个投票`, desc: '将全部关闭并从列表移除' },
  { title: `我的 ${joinedCount.value} 条投票记录`, desc: '将清除你的身份信息' },
  { title: '我的个人资料', desc: '昵称与头像将被清空' }
])

function submit() {
  if (!canSubmit.value) return
  confirming.value = true
}

async function confirmDeactivate() {
  submitting.value = true
  try {
    await deleteAccount()
    confirming.value = false
    user.logout()
    reset(ROUTES.login)
  } catch {
    uni.showToast({ title: '注销失败，请稍后重试', icon: 'none' })
  } finally {
    submitting.value = false
  }
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
            <text class="warn__desc">注销后，你的账号和你发起的投票将被删除，投票记录中的身份信息会被清除。</text>
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

        <text class="deact__note">注销后无法恢复，也无法找回这些投票数据。请确认这是你本人的操作。</text>

        <AppButton size="compact" type="danger" :disabled="!canSubmit" :loading="submitting" @tap="submit">
          确认注销
        </AppButton>
      </view>
    </scroll-view>

    <!-- 二次确认 -->
    <AppSheet
      :visible="confirming"
      variant="confirm"
      title="确认注销账号？"
      desc="账号及全部数据将被永久删除，无法恢复。"
      @close="confirming = false"
    >
      <view class="confirm-actions">
        <view class="flex-1">
          <AppButton type="subtle" size="dialog" @tap="confirming = false">取消</AppButton>
        </view>
        <view class="flex-1">
          <AppButton type="danger" size="dialog" :loading="submitting" @tap="confirmDeactivate">
            注销账号
          </AppButton>
        </view>
      </view>
    </AppSheet>
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

.confirm-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
