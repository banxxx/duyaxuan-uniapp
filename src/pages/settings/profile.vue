<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppAvatar from '@/components/base/AppAvatar.vue'
import { useUserStore } from '@/stores/user'
import { charCount } from '@/utils/format'
import { bottomInset } from '@/utils/platform'

/**
 * 45 编辑资料
 *
 * 昵称、简介直接改本地输入框，点右上角「保存」才提交——
 * 边输边存会让「取消返回」变成「已经改了」，用户没法反悔。
 *
 * 头像走 chooseMedia（微信/QQ 通用），拿到临时路径先本地预览，
 * 保存时和昵称一起提交。真机上是上传到 OSS 再回写 URL，
 * 这里 mock 模式直接把临时路径存下来，够演示。
 */
const user = useUserStore()

const NICK_MAX = 12
const BIO_MAX = 40

const nickname = ref('')
const bio = ref('')
const avatar = ref('')
const saving = ref(false)

const dirty = computed(
  () =>
    nickname.value !== (user.profile?.nickname ?? '') ||
    bio.value !== (user.profile?.bio ?? '') ||
    avatar.value !== (user.profile?.avatar ?? '')
)

const canSave = computed(() => !!nickname.value.trim() && dirty.value && !saving.value)

const joinedText = computed(() => {
  const at = user.profile?.createdAt
  if (!at) return '-'
  const d = new Date(at)
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
})

onMounted(() => {
  nickname.value = user.profile?.nickname ?? ''
  bio.value = user.profile?.bio ?? ''
  avatar.value = user.profile?.avatar ?? ''
})

function pickAvatar() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      avatar.value = res.tempFilePaths[0]
    }
  })
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    await user.updateProfile({
      nickname: nickname.value.trim(),
      bio: bio.value.trim(),
      avatar: avatar.value || undefined
    })
    uni.showToast({ title: '已保存', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 500)
  } catch {
    uni.showToast({ title: '保存失败，请重试', icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="profile">
    <AppNavBar title="编辑资料">
      <template #right>
        <view
          class="profile__save"
          :class="{ 'profile__save--off': !canSave }"
          hover-class="profile__save--active"
          @tap="save"
        >
          <text class="profile__save-text">{{ saving ? '保存中' : '保存' }}</text>
        </view>
      </template>
    </AppNavBar>

    <scroll-view class="profile__scroll" scroll-y>
      <view class="profile__content" :style="{ paddingBottom: bottomInset(20) }">
        <!-- 头像 -->
        <view class="avatar">
          <view class="avatar__box" hover-class="avatar__box--active" @tap="pickAvatar">
            <AppAvatar :src="avatar" :name="nickname || '林'" :size="84" />
          </view>
          <text class="avatar__hint" @tap="pickAvatar">更换头像</text>
        </view>

        <!-- 可编辑 -->
        <view class="group">
          <view class="field">
            <view class="field__head">
              <text class="field__label">昵称</text>
              <text class="field__count">{{ charCount(nickname) }}/{{ NICK_MAX }}</text>
            </view>
            <input
              v-model="nickname"
              class="field__input"
              :maxlength="NICK_MAX"
              placeholder="填写你的昵称"
              placeholder-class="field__ph"
            />
          </view>

          <view class="group__sep" />

          <view class="field">
            <view class="field__head">
              <text class="field__label">个人简介</text>
              <text class="field__count">{{ charCount(bio) }}/{{ BIO_MAX }}</text>
            </view>
            <input
              v-model="bio"
              class="field__input"
              :maxlength="BIO_MAX"
              placeholder="一句话介绍自己"
              placeholder-class="field__ph"
            />
          </view>
        </view>

        <!-- 只读 -->
        <view class="group">
          <view class="row">
            <text class="row__label">用户 ID</text>
            <text class="row__value">{{ user.profile?.id ?? '-' }}</text>
          </view>
          <view class="group__sep" />
          <view class="row">
            <text class="row__label">加入时间</text>
            <text class="row__value">{{ joinedText }}</text>
          </view>
        </view>

        <text class="profile__note">昵称和头像会显示在你发起的投票、评论和投票记录中。</text>
      </view>
    </scroll-view>
  </view>
</template>

<script lang="ts">
export default { name: 'ProfileEditPage' }
</script>

<style lang="scss" scoped>
.profile {
  min-height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  &__save {
    padding: 7px 14px;
    border-radius: 16px;
    background: $accent;
    display: flex;
    align-items: center;

    &--off {
      opacity: 0.4;
    }

    &--active {
      opacity: 0.85;
    }
  }

  &__save-text {
    font-size: 12px;
    font-weight: 600;
    color: #fff;
  }

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

  &__note {
    font-size: 11px;
    color: $faint;
    line-height: 1.6;
    padding: 0 2px;
  }
}

.avatar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 10px 0 4px;

  &__box {
    position: relative;
    border-radius: 42px;
  }

  &__box--active {
    opacity: 0.8;
  }

  &__hint {
    font-size: 12px;
    font-weight: 600;
    color: $accent;
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

.field {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__label {
    font-size: 11px;
    color: $faint;
  }

  &__count {
    font-size: 10px;
    color: $faint;
  }

  &__input {
    font-size: 14px;
    color: $ink;
    height: 20px;
  }

  &__ph {
    color: $faint;
  }
}

.row {
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  &__label {
    font-size: 14px;
    color: $ink;
  }

  &__value {
    font-size: 13px;
    color: $faint;
  }
}
</style>
