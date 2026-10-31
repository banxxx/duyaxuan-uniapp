<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import { bottomInset } from '@/utils/platform'
import { go } from '@/utils/router'
import AppToast from '@/components/base/AppToast.vue'

/**
 * 47 用户协议 / 52 隐私政策 / 48 关于我们
 *
 * 三屏都是「读」的页面，用 ?type= 区分：
 *   terms   用户协议
 *   privacy 隐私政策（47 里「详见《隐私政策》」直接跳过来）
 *   about   关于我们（logo + 版本号）
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

/** 两份文档的更新日期分开维护：改协议不该顺手改掉隐私政策的日期 */
const UPDATED: Record<'terms' | 'privacy', string> = {
  terms: '2026 年 10 月 30 日',
  privacy: '2026 年 10 月 30 日'
}

const DOCS: Record<'terms' | 'privacy', Section[]> = {
  terms: [
    {
      h: '一、协议的适用范围',
      p: '本协议是你与「杜雅轩」小程序运营方（以下简称「我们」）之间，就使用本小程序及相关服务所订立的协议。你通过微信授权登录、创建或参与投票、使用本服务的其他功能，即表示你已完整阅读并同意本协议的全部内容。若你不同意本协议的任何条款，请停止使用本服务。'
    },
    {
      h: '二、服务内容',
      p: '本服务提供发起投票与问卷、邀请他人参与、匿名或实名收集意见、统计并展示结果、汇总回答、发送订阅消息、生成分享海报与小程序码等功能。具体功能以小程序实际提供的为准，我们可能根据运营需要增加、调整或下线部分功能。本服务目前免费提供；如未来推出付费功能，我们会提前公示收费项目与标准。'
    },
    {
      h: '三、账号注册与使用',
      p: '你使用微信账号授权登录，无需单独注册。你应妥善保管自己的微信账号及所用设备，通过该账号进行的一切操作视为你本人的行为。一个微信账号对应一个平台账号，不得出借、转让或买卖。你可以在「设置 · 账号与安全」中随时注销账号，注销后账号会被停用并清除昵称、头像等资料，你发起的投票会被删除。'
    },
    {
      h: '四、内容规范',
      p: '你承诺不利用本服务制作、发布或传播含有下列内容的信息：违反法律法规的；侵害他人名誉权、隐私权、知识产权等合法权益的；骚扰、侮辱、诽谤、恐吓他人的；虚假、欺诈或误导性的；以及其他违背公序良俗的内容。你创建的投票标题、选项、说明和评论均应遵守上述要求。'
    },
    {
      h: '五、使用规范',
      p: '你不得使用脚本、外挂或其他自动化方式批量刷票、刷回答；不得以技术手段攻击、干扰或绕过本服务的正常运行与限制；不得未经许可抓取、复制、镜像本服务的数据；不得冒用他人或机构的身份、名义发起投票。'
    },
    {
      h: '六、你发布的内容',
      p: '你对自己创建或提交的投票、问卷、选项、回答、评论等内容负责，并保证拥有相应的权利。你授予我们在提供本服务所必需的范围内（如展示、统计、生成分享内容）使用这些内容的非独占许可。对于涉嫌违规的内容，我们有权进行隐藏、下架或删除。'
    },
    {
      h: '七、投票与结果的说明',
      p: '匿名投票的「匿名」是对其他用户而言：发起人和其他参与者都无法看到谁投了哪个选项。为保障一人一票并支持你查看自己的参与记录，系统仍会保存账号与投票之间的对应关系，但不会向发起人展示。选择「需个人信息」的投票会收集参与者主动填写的资料，发起人应仅在必要范围内使用。投票结果由参与者的真实意愿产生，仅供参考，不构成任何专业意见或决策依据。投票提交后，除页面明确支持外不可修改或撤回。'
    },
    {
      h: '八、个人信息保护',
      p: '我们按照《隐私政策》收集、使用和保护你的个人信息。《隐私政策》是本协议不可分割的组成部分，请在使用本服务前仔细阅读。'
    },
    {
      h: '九、知识产权',
      p: '本服务的界面设计、图标、文字、程序及相关素材的知识产权归我们或相应权利人所有。未经书面许可，你不得复制、修改、传播或将其用于商业用途。你自行创建的内容，其权利仍归你所有。'
    },
    {
      h: '十、服务的变更、中断与终止',
      p: '我们可能因系统维护、版本升级、故障或不可抗力暂停或终止部分服务。我们会尽量提前通知，但紧急情况下可能无法事先告知。若你严重违反本协议或法律法规，我们有权限制或终止你使用本服务。'
    },
    {
      h: '十一、免责声明',
      p: '本服务按现状提供。你通过微信账号登录使用本服务，还应遵守微信平台的相关规则。因网络故障、设备问题、微信平台规则调整、不可抗力等原因导致的服务中断、数据延迟或丢失，我们在法律允许的范围内不承担责任。对重要的投票结果，建议你自行留存备份。'
    },
    {
      h: '十二、违约责任',
      p: '因你违反本协议或法律法规，给他人或我们造成损失的，你应承担相应责任。我们有权视情节采取警告、限制功能、删除内容、封禁账号等措施，并保留追究法律责任的权利。'
    },
    {
      h: '十三、未成年人使用',
      p: '若你是未满 18 周岁的未成年人，应在监护人的指导下阅读本协议并使用本服务。监护人应引导未成年人正确使用，并对其使用本服务的行为负责。'
    },
    {
      h: '十四、协议的更新',
      p: '我们可能根据法律法规变化或业务调整更新本协议，更新后会在小程序内公布并标注更新日期。更新后你继续使用本服务，即视为接受修订后的协议；若你不同意，请停止使用并注销账号。'
    },
    {
      h: '十五、法律适用与争议解决',
      p: '本协议的订立、履行和解释适用中华人民共和国法律。因本协议产生的争议，双方应友好协商解决；协商不成的，任何一方可向运营方所在地有管辖权的人民法院提起诉讼。本协议部分条款被认定无效的，不影响其他条款的效力。'
    },
    {
      h: '十六、联系我们',
      p: '如对本协议有疑问、意见或投诉，可通过「帮助与反馈」或 posoovo@gmail.com 联系我们，我们会在 15 个工作日内答复。'
    }
  ],
  privacy: [
    {
      h: '一、我们收集哪些信息',
      p: '（1）账号信息：你通过微信授权登录时，微信返回的 openid、unionid，用于识别你的账号。我们不会自动获取你的微信昵称、头像或好友关系，昵称和头像只有你在「编辑资料」中主动选择后才会保存。\n（2）你主动填写的资料：昵称、头像、个人简介。\n（3）你创建的内容：投票与问卷的标题、说明、选项、规则、截止时间。\n（4）参与记录：你选择的选项、提交的问卷回答、提交时间；为支持「限同一 IP 提交」和防刷票，还会记录提交时的 IP 地址。\n（5）互动信息：你发表的评论、点赞记录。\n（6）通知相关：你授权订阅消息的模板、推送记录与已读状态。\n（7）运行日志：接口请求时间、错误信息、IP 地址等，用于故障排查与安全防护。\n我们不会收集你的通讯录、精确位置或微信好友关系。'
    },
    {
      h: '二、我们如何使用这些信息',
      p: '用于完成登录与账号识别；展示和统计你创建或参与的投票；实现一人一票、限制重复提交等规则；向你发送截止提醒、结果通知等消息；处理反馈、投诉与争议；保障服务安全、排查故障。我们不会将你的信息用于广告投放或用户画像，也不会出售给第三方。'
    },
    {
      h: '三、「匿名投票」意味着什么',
      p: '匿名投票的「匿名」是对其他用户而言：发起人和其他参与者都无法看到谁投了哪个选项，相关通知里也不会出现你的昵称。但为保障一人一票、并支持你在「我参与的」中查看自己的记录，系统仍会保存你的账号与投票或回答之间的对应关系，该关系不会展示给发起人。'
    },
    {
      h: '四、信息的存储地点与期限',
      p: '本服务运行在 Cloudflare 的 Workers、D1 与 R2 上，数据可能存储于中国大陆以外的地区，你使用本服务即表示知悉并同意该等处理。数据在你账号存续期间保留。注销账号后，我们会清空昵称、头像、简介并停用账号，删除你发起的投票，清除参与记录中你主动填写的个人信息字段，并删除推送相关数据；为保持投票统计的完整性，不含身份资料的参与记录会继续保留。运行日志由云服务商按其默认策略短期保留。'
    },
    {
      h: '五、信息的共享、转让与公开披露',
      p: '我们不会出售你的个人信息。仅在以下情形共享：为完成微信登录、订阅消息与小程序码生成，与微信平台交换必要信息；为托管服务，数据存储在 Cloudflare；根据法律法规或监管要求，向有权机关提供；在合并、收购等情形下如涉及信息转移，我们会要求承接方继续受本政策约束。除上述情形外，未经你同意，我们不会向第三方提供你的个人信息。'
    },
    {
      h: '六、我们如何保护信息',
      p: '我们通过 HTTPS 传输、登录令牌鉴权、接口访问控制与最小权限等手段保护你的信息，并定期检查。但互联网环境不存在绝对安全，请妥善保管你的微信账号与所用设备。'
    },
    {
      h: '七、你的权利',
      p: '你可以：在「我的」查看和修改昵称、头像、简介；在「我发起的」「我参与的」查看自己的记录；删除自己创建的投票和评论；在「设置 → 缓存」清除本地草稿与搜索历史；在「消息通知」关闭推送，或在「账号与安全」解除微信绑定、注销账号。如需查阅、复制或删除其他信息，可通过「帮助与反馈」联系我们，我们会在 15 个工作日内答复。'
    },
    {
      h: '八、本地存储与缓存',
      p: '为免去重复登录并提升体验，我们会在你的设备上保存登录令牌、资料快照、创建草稿、搜索历史和本地设置。这些数据不会上传，除非你在页面中主动提交。你可以通过「设置 → 缓存」清除草稿与搜索历史，通过「退出登录」清除登录令牌与资料快照。本服务不包含第三方广告 SDK。'
    },
    {
      h: '九、未成年人保护',
      p: '若你未满 14 周岁，应在监护人的同意和指导下使用本服务。监护人发现未成年人未经同意提交了个人信息，可通过「帮助与反馈」联系我们删除。'
    },
    {
      h: '十、第三方服务',
      p: '本服务依赖微信提供登录、订阅消息、小程序码等能力，依赖 Cloudflare 提供计算与存储。这些服务商按其各自的隐私政策处理数据，建议你一并阅读。'
    },
    {
      h: '十一、本政策的更新',
      p: '我们可能更新本政策，更新后会在小程序内公布并标注更新日期；涉及重大变更时，我们会以更显著的方式提示。更新后你继续使用本服务，即视为接受更新后的政策。'
    },
    {
      h: '十二、联系我们',
      p: '如对本政策有任何疑问、意见或投诉，可通过「帮助与反馈」或 posoovo@gmail.com 联系我们，我们会在 15 个工作日内答复。'
    }
  ]
}

const type = ref<DocType>('terms')

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
const updatedAt = computed(() => UPDATED[type.value === 'privacy' ? 'privacy' : 'terms'])

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
    <AppToast />
    <AppNavBar :title="title" />

    <scroll-view class="doc__scroll" scroll-y>
      <!-- 48 关于我们 -->
      <view v-if="isAbout" class="doc__content doc__content--about" :style="{ paddingBottom: bottomInset(20) }">
        <view class="logo">
          <image class="logo__mark" src="/static/logo.png" mode="aspectFill" />
          <text class="logo__name">杜雅轩</text>
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
        </view>

        <text class="doc__copy">© 2026 杜雅轩 · 保留所有权利</text>
      </view>

      <!-- 47 / 52 协议正文 -->
      <view v-else class="doc__content" :style="{ paddingBottom: bottomInset(20) }">
        <text class="doc__updated">更新于 {{ updatedAt }}</text>

        <view v-for="s in sections" :key="s.h" class="section">
          <text class="section__h">{{ s.h }}</text>
          <text class="section__p">{{ s.p }}</text>
        </view>
      </view>
    </scroll-view>

  </view>
</template>

<script lang="ts">
export default { name: 'DocPage' }
</script>

<style lang="scss" scoped>
.doc {
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
    gap: 14px;
  }

  &__updated {
    font-size: $fs-11;
    color: $faint;
    padding-left: 2px;
  }

  &__copy {
    font-size: $fs-11;
    color: $faint;
    text-align: center;
  }
}

.section {
  display: flex;
  flex-direction: column;
  gap: 6px;

  &__h {
    font-size: $fs-14;
    font-weight: 600;
    color: $ink;
  }

  &__p {
    font-size: $fs-12;
    color: $muted;
    line-height: 1.7;
    /* 隐私政策第一条是分行列表，<text> 里的 \n 要靠这个才会真的换行 */
    white-space: pre-line;
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
    border-radius: $r-sheet;
    /* 原图自带蓝底，直接铺满，靠圆角裁出应用图标的样子 */
    overflow: hidden;
    background: $surface;
  }

  &__name {
    font-size: $fs-20;
    font-weight: 700;
    color: $ink;
  }

  &__ver {
    font-size: $fs-12;
    color: $faint;
  }
}

.group {
  border-radius: $r-button;
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
    font-size: $fs-14;
    color: $ink;
  }

  &__value {
    font-size: $fs-13;
    color: $faint;
  }
}
</style>
