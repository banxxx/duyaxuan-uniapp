<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppSkeleton from '@/components/base/AppSkeleton.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import { fetchPoll, fetchMyAnswers, joinPoll } from '@/api/poll'
import { useUserStore } from '@/stores/user'
import { askInviteCode } from '@/utils/invite'
import { ROUTES, replace, reset } from '@/utils/router'

/**
 * 分享落地页（不对外展示，只有一闪而过的骨架）
 *
 * 三个入口都从这里进：
 *   1. 微信好友/群分享卡片 → path 带 id（邀请码模式还会带 code）
 *   2. 小程序码 → scene = `pollId` 或 `pollId-邀请码`（scene 上限 32 字符）
 *   3. 朋友圈单页模式 → 只展示「去小程序」引导
 *
 * 为什么不让卡片直接指详情页：分享给别人的目的是「来投票 / 来填写」，
 * 问卷应该直接落到填写页，已经填过或已截止才回详情页。这段判断放在这里，
 * 详情页、填写页都不用知道自己是怎么被打开的。
 *
 * 落地时顺手 POST /polls/:id/join：邀请码模式校验码，链接模式只记来源，
 * 首页「待我投票」读的就是这条记录。
 *
 * 未登录也能进来：加入、投票时 request.ts 收到 401 会静默 uni.login，
 * 不先跳登录页打断分享链路。
 */
const user = useUserStore()

const pollId = ref('')
/** 链接/二维码里带的邀请码 */
const inviteCode = ref('')
const failed = ref(false)
const loading = ref(true)
/** 邀请码模式，且没带码 / 码不对：停下来让用户输入 */
const needCode = ref(false)
/**
 * 朋友圈「单页模式」（scene=1154）只能看这一页，redirectTo 不会生效。
 * 这时候别再假装在加载，直接告诉用户点底部的「前往小程序」。
 */
const singlePage = ref(false)

async function resolve(code = inviteCode.value) {
  loading.value = true
  failed.value = false
  needCode.value = false
  try {
    const poll = await fetchPoll(pollId.value)

    // 发起人自己预览不用登记；其他人先记录来源 / 校验邀请码
    if (poll.creatorId !== user.profile?.id) {
      try {
        await joinPoll(poll.id, code || undefined)
        inviteCode.value = code
      } catch {
        // 链接模式：记来源失败不该挡住参与。
        // 邀请码模式：没带码或者码不对，都让用户输一次。
        if (poll.rules.joinMethod === 'invite') {
          const next = await askInviteCode()
          if (!next) {
            needCode.value = true
            loading.value = false
            return
          }
          inviteCode.value = ''
          return resolve(next)
        }
      }
    }

    if (poll.type === 'survey') {
      const ended = poll.rules.endAt <= Date.now()
      if (!ended) {
        // 拿不到（比如还没登录）就当没填过：填写页本身是稳妥的落点
        const mine = await fetchMyAnswers(pollId.value).catch(() => [])
        if (!mine.length || poll.rules.allowRepeat) {
          replace(ROUTES.surveyFill, { id: pollId.value })
          return
        }
      }
    }

    replace(ROUTES.detail, { id: pollId.value })
  } catch {
    failed.value = true
    loading.value = false
  }
}

/** 用户取消过一次之后，从空状态里再点「输入邀请码」 */
async function retryCode() {
  const next = await askInviteCode()
  if (next) resolve(next)
}

onLoad((q) => {
  // 扫小程序码时微信给的是 options.scene；普通分享卡片给的是 id + code
  const scene = q?.scene as string | undefined
  if (scene) {
    // scene 形如 pollId 或 pollId-邀请码；pollId 里没有 '-'
    const text = decodeURIComponent(scene)
    const cut = text.indexOf('-')
    pollId.value = cut > 0 ? text.slice(0, cut) : text
    inviteCode.value = cut > 0 ? text.slice(cut + 1) : ''
  } else {
    pollId.value = (q?.id as string) ?? ''
    inviteCode.value = (q?.code as string) ?? ''
  }

  try {
    singlePage.value = uni.getLaunchOptionsSync().scene === 1154
  } catch {
    singlePage.value = false
  }
})

onMounted(() => {
  if (singlePage.value) {
    loading.value = false
    return
  }
  if (!pollId.value) {
    failed.value = true
    loading.value = false
    return
  }
  resolve()
})
</script>

<template>
  <view class="join">
    <view v-if="loading" class="join__body">
      <AppSkeleton type="detail" />
    </view>

    <view v-else class="join__body">
      <AppEmpty
        v-if="singlePage"
        icon="circle-help"
        title="点底部按钮进入小程序"
        desc="朋友圈里只能预览一页，进入小程序后即可直接参与"
      />
      <AppEmpty
        v-else-if="needCode"
        icon="lock"
        title="需要邀请码"
        desc="这份投票只对受邀的人开放，向发起人要一个 6 位邀请码"
        action="输入邀请码"
        @action="retryCode"
      />
      <AppEmpty
        v-else
        icon="link"
        title="这个分享打不开了"
        :desc="pollId ? '投票可能已被删除，或链接不完整' : '缺少投票参数，请重新扫码或让发起人再发一次'"
        action="返回首页"
        @action="reset(ROUTES.home)"
      />
    </view>
  </view>
</template>

<script lang="ts">
export default { name: 'ShareJoinPage' }
</script>

<style lang="scss" scoped>
.join {
  min-height: 100vh;
  background: $bg;

  &__body {
    padding: 8px $gutter;
  }
}
</style>
