<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppSheet from '@/components/base/AppSheet.vue'
import AppButton from '@/components/base/AppButton.vue'
import { bottomInset } from '@/utils/platform'
import { go } from '@/utils/router'

/**
 * 47 用户协议 / 52 隐私政策 / 48 关于我们
 *
 * 三屏都是「读」的页面，用 ?type= 区分：
 *   terms   用户协议
 *   privacy 隐私政策（47 里「详见《隐私政策》」直接跳过来）
 *   about   关于我们（多了 logo 和检查更新）
 *
 * 正文写成结构化数据而不是整段 HTML：小程序里 rich-text 排版难控，
 * 分节渲染能保证标题/正文的字号层级和全站一致。
 */
type DocType = 'terms' | 'privacy' | 'about'

interface Section {
  h: string
  p: string
}

const VERSION = '1.2.0'
const UPDATED_AT = '2026 年 9 月 1 日'

const DOCS: Record<'terms' | 'privacy', Section[]> = {
  terms: [
    {
      h: '一、服务说明',
      p: '本小程序为用户提供创建、分享和参与投票的服务。你可以免费创建投票，并将链接分享给他人参与。'
    },
    {
      h: '二、账号与身份',
      p: '你通过微信授权登录使用本服务。匿名投票不会记录你的身份信息，发起人亦无法查看谁投了票。'
    },
    {
      h: '三、内容规范',
      p: '你创建的投票内容不得包含违法、侵权、骚扰或虚假信息。我们有权对违规内容进行下架处理。'
    },
    {
      h: '四、数据与隐私',
      p: '我们仅收集提供服务所必需的信息，包括你创建的投票、投票记录和你主动填写的资料。详见《隐私政策》。'
    },
    {
      h: '五、免责声明',
      p: '投票结果由参与者真实意愿产生，平台不对投票结论的正确性或适用性负责。'
    }
  ],
  privacy: [
    {
      h: '一、我们收集的信息',
      p: '仅在你主动使用时收集：微信昵称与头像、你创建的投票内容、你的投票记录，以及你在「需个人信息」类投票中主动填写的资料。'
    },
    {
      h: '二、我们如何使用',
      p: '用于展示你的投票与参与记录、统计投票结果、向你发送投票提醒。我们不会将信息用于广告投放或出售给第三方。'
    },
    {
      h: '三、匿名投票',
      p: '匿名投票不记录参与者身份，发起人和其他参与者都无法查看你投了哪个选项。'
    },
    {
      h: '四、你的权利',
      p: '你可以随时查看、更正自己的资料，或解除微信绑定、更换手机号；也可以在「账号与安全」中注销账号，注销后数据将被永久删除。'
    },
    {
      h: '五、联系我们',
      p: '如对隐私有任何疑问，可通过「帮助与反馈」或 support@vote.jun 联系我们，我们会在 3 个工作日内答复。'
    }
  ]
}

const type = ref<DocType>('terms')
const updateSheet = ref(false)

const isAbout = computed(() => type.value === 'about')
const title = computed(() => {
  switch (type.value) {
    case 'privacy':
      return '隐私政策'
    case 'about':
      return '关于我们'
    default:
      return '用户协议'
  }
})
const sections = computed(() => (type.value === 'about' ? [] : DOCS[type.value]))

onLoad((q) => {
  const t = (q?.type as DocType) ?? 'terms'
  if (t === 'privacy' || t === 'about' || t === 'terms') type.value = t
})

function open(url: string) {
  go(url)
}
</script>

<template>
  <view class="doc">
    <AppNavBar :title="title" />

    <scroll-view class="doc__scroll" scroll-y>
      <!-- 48 关于我们 -->
      <view v-if="isAbout" class="doc__content doc__content--about" :style="{ paddingBottom: bottomInset(20) }">
        <view class="logo">
          <view class="logo__mark">
            <AppIcon name="vote" :size="34" color="#FFFFFF" :stroke-width="2" />
          </view>
          <text class="logo__name">投票吧</text>
          <text class="logo__ver">版本 {{ VERSION }}</text>
        </view>

        <view class="group">
          <view class="row" hover-class="row--active" @tap="open('/pages/settings/doc?type=terms')">
            <text class="row__title">用户协议</text>
            <AppIcon name="chevron-right" :size="15" color="#A1A1AA" />
          </view>
          <view class="group__sep" />
          <view class="row" hover-class="row--active" @tap="open('/pages/settings/doc?type=privacy')">
            <text class="row__title">隐私政策</text>
            <AppIcon name="chevron-right" :size="15" color="#A1A1AA" />
          </view>
          <view class="group__sep" />
          <view class="row" hover-class="row--active" @tap="updateSheet = true">
            <text class="row__title">检查更新</text>
            <text class="row__value">已是最新</text>
            <AppIcon name="chevron-right" :size="15" color="#A1A1AA" />
          </view>
        </view>

        <text class="doc__copy">© 2026 投票吧 · 保留所有权利</text>
      </view>

      <!-- 47 / 52 协议正文 -->
      <view v-else class="doc__content" :style="{ paddingBottom: bottomInset(20) }">
        <text class="doc__updated">更新于 {{ UPDATED_AT }}</text>

        <view v-for="s in sections" :key="s.h" class="section">
          <text class="section__h">{{ s.h }}</text>
          <text class="section__p">{{ s.p }}</text>
        </view>
      </view>
    </scroll-view>

    <AppSheet
      :visible="updateSheet"
      variant="confirm"
      title="已是最新版本"
      :desc="`当前版本 ${VERSION}，无需更新。我们会持续优化投票体验。`"
      @close="updateSheet = false"
    >
      <AppButton size="dialog" @tap="updateSheet = false">知道了</AppButton>
    </AppSheet>
  </view>
</template>

<script lang="ts">
export default { name: 'DocPage' }
</script>

<style lang="scss" scoped>
.doc {
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
    gap: 14px;
  }

  &__updated {
    font-size: 11px;
    color: $faint;
    padding-left: 2px;
  }

  &__copy {
    font-size: 11px;
    color: $faint;
    text-align: center;
  }
}

.section {
  display: flex;
  flex-direction: column;
  gap: 6px;

  &__h {
    font-size: 14px;
    font-weight: 600;
    color: $ink;
  }

  &__p {
    font-size: 12px;
    color: $muted;
    line-height: 1.7;
  }
}

.logo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 30px 0 10px;

  &__mark {
    width: 72px;
    height: 72px;
    border-radius: 20px;
    background: $accent;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__name {
    font-size: 20px;
    font-weight: 700;
    color: $ink;
  }

  &__ver {
    font-size: 12px;
    color: $faint;
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

.row {
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 4px;

  &--active {
    background: $subtle;
  }

  &__title {
    flex: 1;
    font-size: 14px;
    color: $ink;
  }

  &__value {
    font-size: 13px;
    color: $faint;
  }
}
</style>
