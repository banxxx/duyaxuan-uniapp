<template>
  <view class="page" :style="{ paddingTop: `${contentTop}px` }">
    <view class="page__content">
      <view class="page__top">
        <!-- Profile Head：头像 + 昵称 + 右上角铃铛/设置 -->
        <view class="profile">
          <!-- 头像可点：头像和昵称只能用微信的「头像昵称填写能力」拿，
               没有独立的资料页，就地弹层改 -->
          <view class="profile__avatar" hover-class="is-pressed" @tap="openEditor">
            <AppAvatar
              :src="user.profile?.avatar"
              :name="name"
              :seed="user.profile?.id"
              :size="64"
            />
            <view class="profile__badge">
              <AppIcon name="square-pen" :size="9" color="#FFFFFF" :stroke-width="2.5" />
            </view>
          </view>
          <view class="profile__info">
            <text class="profile__name">{{ name }}</text>
            <text class="profile__meta">{{ joinedText }}</text>
          </view>
          <view class="profile__actions">
            <view class="profile__icon" hover-class="profile__icon--active" @tap="open('/pages/settings/notifications')">
              <AppIcon name="bell" :size="17" color="#09090B" />
              <view v-if="unread" class="profile__dot" />
            </view>
            <view class="profile__icon" hover-class="profile__icon--active" @tap="open('/pages/settings/index')">
              <AppIcon name="settings" :size="17" color="#09090B" />
            </view>
          </view>
        </view>

        <!-- 两组入口 -->
        <view class="entries">
          <view class="entry" hover-class="entry--active" @tap="open('/pages/me/created')">
            <view class="entry__icon">
              <AppIcon name="file-text" :size="18" color="#4F46E5" />
            </view>
            <view class="entry__text">
              <text class="entry__title">我发起的</text>
              <text class="entry__desc">管理我发起的投票与问卷</text>
            </view>
            <view class="entry__right">
              <text v-if="createdCount !== null" class="entry__count">{{ createdCount }}</text>
              <AppIcon name="chevron-right" :size="15" color="#A1A1AA" />
            </view>
          </view>

          <view class="entry" hover-class="entry--active" @tap="open('/pages/me/joined')">
            <view class="entry__icon">
              <AppIcon name="square-check" :size="18" color="#4F46E5" />
            </view>
            <view class="entry__text">
              <text class="entry__title">我参与的</text>
              <text class="entry__desc">查看我参与过的投票与问卷</text>
            </view>
            <view class="entry__right">
              <text v-if="joinedCount !== null" class="entry__count">{{ joinedCount }}</text>
              <AppIcon name="chevron-right" :size="15" color="#A1A1AA" />
            </view>
          </view>
        </view>
      </view>

      <!-- 设计稿 40：帮助与反馈是底部一个居中链接，不是列表行 -->
      <view class="page__help" @tap="open('/pages/support/index')">
        <text class="page__help-text">帮助与反馈</text>
      </view>
    </view>

    <!-- 编辑资料：头像和昵称都只能由用户主动从平台取，小程序读不到。
         昵称不做自由输入，只给「用平台昵称 / 用默认昵称」两个选项 -->
    <AppSheet :visible="editing" title="编辑资料" @close="closeEditor">
      <view class="editor">
        <button class="editor__avatar" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
          <AppAvatar
            :src="draftAvatar || user.profile?.avatar"
            :name="draftNickname || name"
            :seed="user.profile?.id"
            :size="76"
          />
        </button>
        <text class="editor__hint">点击头像使用{{ platformName }}头像</text>

        <view class="editor__field">
          <text class="editor__label">昵称</text>
          <view class="editor__options">
            <view
              class="editor__option"
              :class="{ 'editor__option--on': platformActive }"
              hover-class="editor__option--active"
              @tap="usePlatformNickname"
            >
              <text class="editor__option-title">{{ platformTitle }}</text>
              <view class="editor__option-right">
                <text class="editor__option-value" :class="{ 'editor__option-value--on': platformActive }">
                  {{ platformValue }}
                </text>
                <text v-if="platformNick" class="editor__option-refresh" @tap.stop="refreshPlatformNickname">重新获取</text>
              </view>
            </view>
            <!-- 已经用上平台昵称之后就不给退回了：默认昵称不再出现 -->
            <template v-if="!nickLocked">
              <view class="editor__sep" />
              <view
                class="editor__option"
                :class="{ 'editor__option--on': nickSource === 'default' }"
                hover-class="editor__option--active"
                @tap="useDefaultNickname"
              >
                <text class="editor__option-title">使用默认昵称</text>
                <text
                  class="editor__option-value"
                  :class="{ 'editor__option-value--on': nickSource === 'default' }"
                >
                  {{ defaultNickname }}
                </text>
              </view>
            </template>
          </view>
          <!-- 占位：授权前后这块高度必须一样，否则「取消/保存」会往上跳 -->
          <view class="editor__spacer" />
        </view>

        <!-- 拿平台昵称的唯一途径：type=nickname 的输入框，聚焦后键盘上方会出现
             平台昵称建议。这里只是借它拿值，用户不该看到也不该打字，所以缩到 1px -->
        <input
          class="editor__ghost"
          type="nickname"
          :value="nickInput"
          :focus="nickFocus"
          @input="onPlatformNickname"
          @blur="onNickBlur"
        />
      </view>

      <view class="editor__actions">
        <view class="flex-1">
          <AppButton type="subtle" size="dialog" @tap="closeEditor">取消</AppButton>
        </view>
        <view class="flex-1">
          <AppButton size="dialog" :loading="saving" :disabled="!canSave" @tap="save">
            保存
          </AppButton>
        </view>
      </view>
    </AppSheet>

    <AppTabBar current="me" />
    <view class="page__tabspace" :style="{ height: `calc(64px + ${safeBottom}px)` }" />
  </view>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppIcon from '@/components/base/AppIcon.vue'
import AppAvatar from '@/components/base/AppAvatar.vue'
import AppTabBar from '@/components/base/AppTabBar.vue'
import AppSheet from '@/components/base/AppSheet.vue'
import AppButton from '@/components/base/AppButton.vue'
import { useUserStore } from '@/stores/user'
import { fetchMyPolls, fetchJoinedPolls } from '@/api/poll'
import { uploadAvatar, updateNickname } from '@/api/auth'
import { getSafeArea, getPlatform } from '@/utils/platform'
import { hideNativeTabBar } from '@/utils/tab'
import { go, ROUTES } from '@/utils/router'

/**
 * 40 我的
 *
 * 设计稿没有导航栏：昵称就是页面标题（24/bold），铃铛和齿轮跟着这一行靠右。
 * 所以整块内容整体下移到胶囊下沿以下，右上角两个 38 的按钮才不会被胶囊盖住。
 *
 * 入口右侧的数字和对应列表页的总数一致，都取 total，不在前端另算。
 */
const user = useUserStore()
const name = computed(() => user.profile?.nickname ?? '未登录')
const joinedDays = computed(() => {
  const at = user.profile?.createdAt
  if (!at) return 0
  return Math.floor((Date.now() - at) / (24 * 3600 * 1000))
})

/** 刚注册的账号写「加入 0 天」很怪，单独说「今天加入」 */
const joinedText = computed(() => (joinedDays.value > 0 ? `加入 ${joinedDays.value} 天` : '今天加入'))

const { contentTop, safeBottom } = getSafeArea()

const createdCount = ref<number | null>(null)
const joinedCount = ref<number | null>(null)
const unread = ref(true)

onMounted(async () => {
  try {
    const [mine, joined] = await Promise.all([fetchMyPolls('all'), fetchJoinedPolls('all')])
    createdCount.value = mine.total
    joinedCount.value = joined.total
  } catch {
    // 计数只是辅助信息，取不到就不显示
  }
})

/** H5 端会渲染原生 tabBar，进来就藏掉（微信端 custom=true，没有原生栏，静默失败） */
onShow(hideNativeTabBar)

function open(url: string) {
  go(url)
}

/* ---------------- 编辑资料 ---------------- */

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

/** 注册时后端按 id 后四位生成的昵称（server/src/db/users.ts），想「用默认的」就回到这个 */
const defaultNickname = computed(() => {
  const id = user.profile?.id
  return id ? `用户${id.slice(-4).toUpperCase()}` : '用户'
})

const editing = ref(false)
const saving = ref(false)
const draftNickname = ref('')
/** chooseAvatar 给的临时文件路径；空串表示这次没换头像 */
const draftAvatar = ref('')
/** 昵称来源，只用来给两个选项做选中态；null = 这次没动昵称 */
const nickSource = ref<'platform' | 'default' | null>(null)
/** 隐藏的 nickname 输入框的值，只当取值通道用 */
const nickInput = ref('')
const nickFocus = ref(false)
/** 上次从平台拿到的昵称：记住之后切来切去就不用再走一遍键盘授权 */
const platformNick = ref('')
/** 打开弹层时定格：昵称已经是平台昵称了，就不再提供「默认昵称」这个选项 */
const nickLocked = ref(false)

const PLATFORM_NICK_PREFIX = 'dyx_platform_nick_'

function readPlatformNick(id?: string): string {
  if (!id) return ''
  try {
    return String(uni.getStorageSync(PLATFORM_NICK_PREFIX + id) || '')
  } catch {
    return ''
  }
}

function savePlatformNick(id: string | undefined, value: string) {
  if (!id) return
  try {
    uni.setStorageSync(PLATFORM_NICK_PREFIX + id, value)
  } catch {
    // 存不下就只在本次会话里有效
  }
}

/** 已经用上平台昵称：选项显示成「微信昵称」而不是「使用微信昵称」，并常亮选中态 */
const platformActive = computed(() => nickLocked.value || nickSource.value === 'platform')
const platformTitle = computed(() => `${nickLocked.value ? '' : '使用'}${platformName.value}昵称`)
const platformValue = computed(() =>
  nickSource.value === 'platform' ? draftNickname.value : platformNick.value || '点击获取'
)

const canSave = computed(() => !!draftNickname.value.trim() && !saving.value)

function openEditor() {
  draftNickname.value = user.profile?.nickname ?? ''
  draftAvatar.value = ''
  nickSource.value = null
  nickInput.value = ''
  nickFocus.value = false
  platformNick.value = readPlatformNick(user.profile?.id)
  // 当前昵称就是平台昵称 → 以后只能用它，默认昵称不再出现
  nickLocked.value = !!platformNick.value && platformNick.value === user.profile?.nickname
  editing.value = true
}

function closeEditor() {
  nickFocus.value = false
  hideKeyboard()
  editing.value = false
}

/** 收起键盘：隐藏输入框拿到值以后没必要让它一直开着 */
function hideKeyboard() {
  try {
    uni.hideKeyboard()
  } catch {
    // H5 上没有这个能力，忽略
  }
}

/**
 * 平台昵称没有「一键授权」的接口：微信从 2022 年起收回了 getUserProfile，
 * 只剩 input[type=nickname] —— 聚焦后键盘上方会出现「使用微信昵称」。
 * 所以不把这个框露出来让用户打字，只借它取值。
 */
function usePlatformNickname() {
  // 授权过一次就记着了，直接用，不再弹键盘
  if (platformNick.value) {
    draftNickname.value = platformNick.value
    nickSource.value = 'platform'
    return
  }
  refreshPlatformNickname()
}

/** 重新走一遍平台授权（昵称改过时用） */
function refreshPlatformNickname() {
  nickInput.value = ''
  nickFocus.value = false
  // 先清空再聚焦：键盘弹出时框里是空的，用户直接点建议里的昵称即可
  nextTick(() => {
    nickFocus.value = true
  })
}

function onPlatformNickname(e: Event) {
  // 小程序把值放在 detail.value，H5 的原生 input 事件在 target.value
  const ev = e as unknown as { detail?: { value?: string }; target?: { value?: string } }
  const value = (ev.detail?.value ?? ev.target?.value ?? '').trim()
  if (!value) return
  nickInput.value = value
  draftNickname.value = value
  nickSource.value = 'platform'
  platformNick.value = value
  savePlatformNick(user.profile?.id, value)
  hideKeyboard()
}

function onNickBlur() {
  nickFocus.value = false
}

function useDefaultNickname() {
  nickFocus.value = false
  hideKeyboard()
  draftNickname.value = defaultNickname.value
  nickSource.value = 'default'
}

function onChooseAvatar(e: { detail?: { avatarUrl?: string } }) {
  const url = e?.detail?.avatarUrl
  if (url) draftAvatar.value = url
}

async function save() {
  const nickname = draftNickname.value.trim()
  if (!nickname || saving.value) return

  saving.value = true
  try {
    let next = user.profile
    // 先传头像：临时路径必须立刻落库，放着会失效
    if (draftAvatar.value) {
      next = await uploadAvatar(draftAvatar.value)
      user.applyProfile(next)
    }
    if (nickname !== next?.nickname) {
      next = await updateNickname(nickname)
      user.applyProfile(next)
    }
    editing.value = false
    uni.showToast({ title: '已保存', icon: 'none' })
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '保存失败，请重试', icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<script lang="ts">
export default { name: 'MePage' }
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;

  /* 设计稿 Content：gap 16、padding [8,20,12,20]，帮助链接被 space_between 推到底部 */
  &__content {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 16px;
    padding: 8px $gutter 12px;
  }

  &__top {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  &__help {
    padding-top: 8px;
    display: flex;
    justify-content: center;
  }

  &__help-text {
    font-size: 12px;
    color: $faint;
  }
}

.profile {
  display: flex;
  align-items: center;
  gap: 14px;

  &__info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  &__name {
    font-size: 24px;
    font-weight: 700;
    color: $ink;
    line-height: 1.25;
  }

  &__meta {
    font-size: 12px;
    color: $faint;
  }

  /* 头像外框只负责定位角标，尺寸交给 AppAvatar */
  &__avatar {
    position: relative;
    flex-shrink: 0;
  }

  /* 角标：提示「这里能点」，否则用户不会想到头像可以改 */
  &__badge {
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: 20px;
    height: 20px;
    border-radius: 10px;
    background: $accent;
    border: 2px solid $bg;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  /* 设计稿：38×38、圆 19、白底、1px $line、图标 17 */
  &__icon {
    width: 38px;
    height: 38px;
    border-radius: 19px;
    background: $surface;
    border: 1px solid $line;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;

    &--active {
      opacity: 0.7;
    }
  }

  &__dot {
    position: absolute;
    top: 8px;
    right: 6px;
    width: 8px;
    height: 8px;
    border-radius: 4px;
    background: $danger;
    border: 1.5px solid $surface;
  }
}

/* 设计稿 Poll Entries：竖向 gap 10，每张卡都是独立的圆角 16 白卡 */
.entries {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.entry {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: $surface;
  border: 1px solid $line;
  border-radius: 16px;

  &--active {
    background: $subtle;
  }

  &__icon {
    width: 38px;
    height: 38px;
    border-radius: 12px;
    background: $accent-soft;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    color: $ink;
  }

  &__desc {
    font-size: 11px;
    color: $faint;
  }

  &__right {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  &__count {
    font-size: 13px;
    font-weight: 600;
    color: $muted;
    font-family: $font-num;
  }
}

/* ---------------- 编辑资料弹层 ---------------- */
.editor {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;

  /* 小程序 button 自带内边距、边框和 ::after 描边，全部抹掉只留头像 */
  &__avatar {
    padding: 0;
    margin: 0;
    background: transparent;
    border: none;
    line-height: 0;
    border-radius: 50%;
    overflow: hidden;

    &::after {
      border: none;
    }
  }

  &__hint {
    font-size: 11px;
    color: $faint;
  }

  &__field {
    width: 100%;
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__label {
    font-size: 12px;
    font-weight: 600;
    color: $ink;
  }

  /* 两个昵称来源：白底 + 1px $line + 12 圆角，和「添加选项」弹层同一套 */
  &__options {
    border-radius: 12px;
    background: $surface;
    border: 1px solid $line;
    overflow: hidden;
  }

  &__sep {
    height: 1px;
    background: $line;
  }

  &__option {
    padding: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;

    &--on {
      background: $accent-soft;
    }

    &--active {
      background: $subtle;
    }
  }

  &__option-title {
    font-size: 13px;
    color: $ink;
    flex-shrink: 0;
  }

  &__option-right {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  &__option-value {
    font-size: 12px;
    color: $faint;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;

    &--on {
      color: $accent-ink;
      font-weight: 600;
    }
  }

  /* 记住的昵称可能已经过期（用户改过平台昵称），留一个重新获取的入口 */
  &__option-refresh {
    font-size: 11px;
    color: $accent;
    flex-shrink: 0;
  }

  /* 固定高度，和原来那行提示一样高：去掉文字但保留空间，弹层不会跳动 */
  &__spacer {
    height: 18px;
  }

  /* 只用来接平台昵称的隐藏输入框：留 1px 在角落，不参与视觉 */
  &__ghost {
    position: absolute;
    top: 0;
    left: 0;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  &__actions {
    /* AppSheet 的 gap 只作用于面板直接子节点，插槽内容是一整块，
       所以这里的间距要自己给 */
    margin-top: 16px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
}
</style>
