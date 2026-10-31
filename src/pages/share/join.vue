<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppNavBar from '@/components/base/AppNavBar.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppInviteCode from '@/components/base/AppInviteCode.vue'
import { fetchPoll, fetchMyAnswers, joinPoll } from '@/api/poll'
import { useUserStore } from '@/stores/user'
import { useInviteCode } from '@/utils/invite'
import { ApiError } from '@/utils/request'
import { ROUTES, replace, reset } from '@/utils/router'
import AppToast from '@/components/base/AppToast.vue'

/**
 * 分享落地页（不对外展示，只有一闪而过的加载）
 *
 * 三个入口都从这里进：
 *   1. 微信好友/群分享卡片 → path 只带 id
 *   2. 小程序码 → scene = pollId（scene 上限 32 字符）
 *   3. 朋友圈单页模式 → 只展示「去小程序」引导
 *
 * 邀请码不随链接 / 小程序码传播：旧链接里即使带了 code 也忽略，
 * 统一在这里停下来让参与者单独输入，避免「转发即准入」。
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
const invite = useInviteCode()

const pollId = ref('')
const failed = ref(false)
/** 410：发起人删除了投票，单独说清楚，而不是「链接不完整」 */
const deleted = ref(false)
const loading = ref(true)
/** 邀请码模式，且没带码 / 码不对：停下来让用户输入 */
const needCode = ref(false)
/**
 * 朋友圈「单页模式」（scene=1154）只能看这一页，redirectTo 不会生效。
 * 这时候别再假装在加载，直接告诉用户点底部的「前往小程序」。
 */
const singlePage = ref(false)

/** 弹层提交时的校验：尝试加入，成功返回 null，失败返回文案 */
function joinWith(candidate: string, id = pollId.value): Promise<string | null> {
  return joinPoll(id, candidate).then(
    () => null,
    (e: { code?: number; message?: string }) =>
      e?.code === 403 ? '邀请码不正确，请重新输入' : e?.message || '网络异常，请稍后重试'
  )
}

/**
 * @param joined 已经通过弹层校验并加入成功，不用再 join 一次
 */
async function resolve(code?: string, joined = false) {
  // 重新校验邀请码时不要把页面切回加载态：弹层背后保持「需要邀请码」，
  // 否则会闪一下，看起来像页面又重载了。
  if (!needCode.value) loading.value = true
  failed.value = false
  deleted.value = false

  try {
    const poll = await fetchPoll(pollId.value)

    // 发起人自己预览不用登记；其他人先记录来源 / 校验邀请码
    if (!joined && poll.creatorId !== user.profile?.id) {
      try {
        await joinPoll(poll.id, code)
      } catch (err) {
        // 只有 403 才是「需要邀请码 / 邀请码不对」。
        // 网络错误、500 等照常走失败页，不要误弹输入框。
        const needInvite =
          poll.rules.joinMethod === 'invite' && (err as { code?: number })?.code === 403
        if (!needInvite) throw err

        // 先把页面切到静止的「需要邀请码」，再弹层。
        // 弹层背后如果还是骨架屏，会一直扫光，看着像卡死了。
        needCode.value = true
        loading.value = false

        const next = await invite.ask({
          initial: code,
          // 校验交给弹层的「进入」按钮：码错了留在原地抖动提示，不用收起再弹出
          validate: (candidate) => joinWith(candidate, poll.id)
        })
        if (!next) return
        // 加入已经在 validate 里完成，继续往下走
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
  } catch (err) {
    needCode.value = false
    failed.value = true
    if (err instanceof ApiError && (err.code === 404 || err.code === 410)) deleted.value = true
    loading.value = false
  }
}

/** 用户取消过一次之后，从空状态里再点「输入邀请码」 */
async function retryCode() {
  // 直接弹层，不再等一次 fetchPoll + 403：点了按钮就该立刻唤起键盘
  const code = await invite.ask({
    validate: (candidate) => joinWith(candidate)
  })
  if (code) resolve(code, true)
}

onLoad((q) => {
  // 扫小程序码时微信给的是 options.scene；普通分享卡片给的是 id。
  // 旧链接/旧码可能还带着 code，这里一律忽略 —— 邀请码必须由参与者单独输入。
  const scene = q?.scene as string | undefined
  if (scene) {
    // scene 形如 pollId 或（旧码）pollId-邀请码；pollId 里没有 '-'
    const text = decodeURIComponent(scene)
    const cut = text.indexOf('-')
    pollId.value = cut > 0 ? text.slice(0, cut) : text
  } else {
    pollId.value = (q?.id as string) ?? ''
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
    <AppToast />
    <!--
      自定义导航栏负责让开状态栏 / 胶囊。没有它时内容从屏幕最顶上开始，
      真机上会和状态栏叠在一起，看起来「整体往上偏了一截」。
      返回键在「需要邀请码」停住时也有用：栈里没有上一页会回到首页。
    -->
    <AppNavBar />

    <!--
      落地页只是一个中转，正常一两百毫秒就跳走了，不该摆一屏「详情页骨架」。
      慢网时停在这里，给一个安静的转圈也比一直扫光的骨架屏更像「正在进入」。
    -->
    <view v-if="loading" class="join__body">
      <view class="join__loading">
        <view class="join__spinner" />
        <text class="join__loading-text">正在进入…</text>
      </view>
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
        desc="只对受邀的人开放，请先获取 6 位邀请码"
        action="输入邀请码"
        @action="retryCode"
      />
      <AppEmpty
        v-else-if="deleted"
        icon="trash-2"
        title="该投票已被发起人删除"
        desc="链接已经失效，去首页看看别的投票吧"
        action="返回首页"
        @action="reset(ROUTES.home)"
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

    <AppInviteCode
      :visible="invite.state.visible"
      :initial="invite.state.initial"
      :validating="invite.state.validating"
      :error="invite.state.error"
      :error-seq="invite.state.errorSeq"
      @close="invite.close()"
      @submit="invite.submit"
    />
  </view>
</template>

<script lang="ts">
export default { name: 'ShareJoinPage' }
</script>

<style lang="scss" scoped>
.join {
  min-height: 100vh;
  /* #ifdef H5 */
  min-height: 100dvh;
  /* #endif */
  background: $bg;

  &__body {
    padding: 8px $gutter;
  }

  &__loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding-top: 80px;
  }

  &__spinner {
    width: 24px;
    height: 24px;
    border: 2px solid $line;
    border-top-color: $accent;
    border-radius: 50%;
    animation: join-spin 0.8s linear infinite;
  }

  &__loading-text {
    font-size: $fs-13;
    color: $faint;
  }
}

@keyframes join-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
