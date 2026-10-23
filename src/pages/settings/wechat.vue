<script setup lang="ts">
import { ref, computed } from 'vue'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppAvatar from '@/components/base/AppAvatar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSheet from '@/components/base/AppSheet.vue'
import { useUserStore } from '@/stores/user'
import { unbindWechat } from '@/api/auth'
import { getPlatform, bottomInset } from '@/utils/platform'

/**
 * 54 授权管理（微信 / QQ / 抖音共用）
 *
 * 标题和文案随宿主变：QQ 包里写「QQ 授权」，抖音包里写「抖音授权」。
 * 硬编码「微信」在 QQ 上会让人以为绑错了号。
 *
 * 解除绑定是危险操作，走底部确认面板，不直接生效——
 * 解绑后没法一键登录，只能重新授权，误触代价太大。
 */
const user = useUserStore()

const platformName = computed(() => {
  switch (getPlatform()) {
    case 'qq':
      return 'QQ'
    case 'toutiao':
      return '抖音'
    default:
      return '微信'
  }
})

const name = computed(() => user.profile?.nickname ?? '-')
const bound = computed(() => !!user.profile?.bound)

const confirmVisible = ref(false)
const unbinding = ref(false)

function openConfirm() {
  if (!bound.value) {
    uni.showToast({ title: '尚未绑定', icon: 'none' })
    return
  }
  confirmVisible.value = true
}

async function doUnbind() {
  if (unbinding.value) return
  unbinding.value = true
  try {
    const next = await unbindWechat()
    user.applyProfile(next)
    confirmVisible.value = false
    uni.showToast({ title: '已解除绑定', icon: 'none' })
  } catch {
    uni.showToast({ title: '操作失败，请重试', icon: 'none' })
  } finally {
    unbinding.value = false
  }
}
</script>

<template>
  <view class="bind">
    <AppNavBar :title="`${platformName}授权`" />

    <scroll-view class="bind__scroll" scroll-y>
      <view class="bind__content" :style="{ paddingBottom: bottomInset(20) }">
        <text class="bind__group">当前绑定</text>

        <view class="card">
          <AppAvatar :src="user.profile?.avatar" :name="name" :size="48" />
          <view class="card__text">
            <text class="card__name">{{ name }}</text>
            <text class="card__desc">
              {{ bound ? `已授权 · 昵称与头像` : '尚未授权' }}
            </text>
          </view>
          <view class="card__tag" :class="{ 'card__tag--off': !bound }">
            <text class="card__tag-text" :class="{ 'card__tag-text--off': !bound }">
              {{ bound ? '已绑定' : '未绑定' }}
            </text>
          </view>
        </view>

        <text class="bind__group">授权内容</text>

        <view class="group">
          <view class="scope">
            <AppIcon name="check" :size="16" color="#16A34A" :stroke-width="2.4" />
            <view class="scope__text">
              <text class="scope__title">公开信息</text>
              <text class="scope__desc">昵称、头像</text>
            </view>
          </view>
          <view class="group__sep" />
          <view class="scope">
            <AppIcon name="check" :size="16" color="#16A34A" :stroke-width="2.4" />
            <view class="scope__text">
              <text class="scope__title">投票数据</text>
              <text class="scope__desc">你创建的投票与参与记录</text>
            </view>
          </view>
        </view>

        <text class="bind__note">
          解除绑定后将无法使用{{ platformName }}一键登录，需重新授权后才能继续使用。
        </text>

        <view class="unbind" hover-class="unbind--active" @tap="openConfirm">
          <text class="unbind__text">解除绑定</text>
        </view>
      </view>
    </scroll-view>

    <AppSheet
      :visible="confirmVisible"
      variant="confirm"
      title="解除绑定？"
      :desc="`解除后将无法使用${platformName}一键登录，需要重新授权才能继续使用。`"
      @close="confirmVisible = false"
    >
      <view class="actions">
        <AppButton type="subtle" size="dialog" @tap="confirmVisible = false">取消</AppButton>
        <AppButton type="danger" size="dialog" :loading="unbinding" @tap="doUnbind">解除绑定</AppButton>
      </view>
    </AppSheet>
  </view>
</template>

<script lang="ts">
export default { name: 'WechatBindPage' }
</script>

<style lang="scss" scoped>
.bind {
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

.card {
  padding: 16px;
  border-radius: 14px;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  gap: 12px;

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  &__name {
    font-size: 15px;
    font-weight: 600;
    color: $ink;
  }

  &__desc {
    font-size: 11px;
    color: $faint;
  }

  &__tag {
    padding: 4px 8px;
    border-radius: 6px;
    background: $accent-soft;
    flex-shrink: 0;

    &--off {
      background: $subtle;
    }
  }

  &__tag-text {
    font-size: 11px;
    font-weight: 600;
    color: $accent-ink;

    &--off {
      color: $faint;
    }
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

.scope {
  padding: 13px 15px;
  display: flex;
  align-items: center;
  gap: 10px;

  &__text {
    display: flex;
    flex-direction: column;
    gap: 2px;
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

.unbind {
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

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
