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
import AppToast from '@/components/base/AppToast.vue'
import { toast } from '@/utils/toast'

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
  if (getPlatform() === 'h5') {
    if (user.authProvider === 'qq') return 'QQ'
    if (user.authProvider === 'weixin') return '微信'
    return '账号'
  }
  switch (getPlatform()) {
    case 'qq':
      return 'QQ'
    case 'toutiao':
      return '抖音'
    default:
      return '微信'
  }
})

/**
 * 解绑时传给后端的平台。
 * 小程序端宿主就是登录平台；H5 必须用扫码时记下的 authProvider。
 */
const bindPlatform = computed(() => {
  if (getPlatform() !== 'h5') return getPlatform()
  return user.authProvider || 'weixin'
})

const name = computed(() => user.profile?.nickname ?? '-')
const bound = computed(() => !!user.profile?.bound)

const confirmVisible = ref(false)
const unbinding = ref(false)

function openConfirm() {
  if (!bound.value) {
    toast.show('尚未绑定')
    return
  }
  confirmVisible.value = true
}

async function doUnbind() {
  if (unbinding.value) return
  unbinding.value = true
  try {
    const next = await unbindWechat(bindPlatform.value)
    user.applyProfile(next)
    confirmVisible.value = false
    toast.success('已解除绑定')
  } catch {
    // 失败原因由请求层统一 toast，这里不再重复
  } finally {
    unbinding.value = false
  }
}
</script>

<template>
  <view class="bind">
    <AppToast />
    <AppNavBar :title="`${platformName}授权`" />

    <scroll-view class="bind__scroll" scroll-y>
      <view class="bind__content" :style="{ paddingBottom: bottomInset(20) }">
        <text class="bind__group">当前绑定</text>

        <view class="card">
          <AppAvatar
            :src="user.profile?.avatar"
            :name="name"
            :seed="user.profile?.id"
            :size="48"
          />
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
            <AppIcon name="check" :size="16" color="#047857" :stroke-width="2.4" />
            <view class="scope__text">
              <text class="scope__title">公开信息</text>
              <text class="scope__desc">昵称、头像</text>
            </view>
          </view>
          <view class="group__sep" />
          <view class="scope">
            <AppIcon name="check" :size="16" color="#047857" :stroke-width="2.4" />
            <view class="scope__text">
              <text class="scope__title">投票数据</text>
              <text class="scope__desc">你创建的投票与参与记录</text>
            </view>
          </view>
        </view>

        <text class="bind__note">
          解除绑定后，这个账号将无法再用{{ platformName }}登录；重新授权会创建一个新账号，
          已发起的投票和参与记录无法找回。请确认不再需要这些数据后再操作。
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
      :desc="`解除后将无法再用${platformName}登录；重新授权会创建新账号，历史数据无法找回。`"
      @close="confirmVisible = false"
    >
      <view class="actions">
        <view class="flex-1">
          <AppButton type="subtle" size="dialog" @tap="confirmVisible = false">取消</AppButton>
        </view>
        <view class="flex-1">
          <AppButton type="danger" size="dialog" :loading="unbinding" @tap="doUnbind">
            解除绑定
          </AppButton>
        </view>
      </view>
    </AppSheet>
  </view>
</template>

<script lang="ts">
export default { name: 'WechatBindPage' }
</script>

<style lang="scss" scoped>
.bind {
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

  &__group {
    font-size: $fs-11;
    font-weight: 600;
    color: $faint;
  }

  &__note {
    font-size: $fs-11;
    color: $faint;
    line-height: 1.6;
    padding: 0 2px;
  }
}

.card {
  padding: 16px;
  border-radius: $r-input;
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
    font-size: $fs-15;
    font-weight: 600;
    color: $ink;
  }

  &__desc {
    font-size: $fs-11;
    color: $faint;
  }

  &__tag {
    padding: 4px 8px;
    border-radius: $r-xs;
    background: $accent-soft;
    flex-shrink: 0;

    &--off {
      background: $subtle;
    }
  }

  &__tag-text {
    font-size: $fs-11;
    font-weight: 600;
    color: $accent-ink;

    &--off {
      color: $disabled;
    }
  }
}

.group {
  border-radius: $r-input;
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
    font-size: $fs-13;
    color: $ink;
  }

  &__desc {
    font-size: $fs-11;
    color: $faint;
  }
}

.unbind {
  height: 48px;
  border-radius: $r-input;
  background: $surface;
  border: 1px solid $line;
  display: flex;
  align-items: center;
  justify-content: center;

  &--active {
    background: $subtle;
  }

  &__text {
    font-size: $fs-14;
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
