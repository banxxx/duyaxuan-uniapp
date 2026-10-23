<script setup lang="ts">
import { onLaunch, onShow, onError } from '@dcloudio/uni-app'
import { useUserStore } from '@/stores/user'
import { getPlatform } from '@/utils/platform'

onLaunch(() => {
  // 记录运行平台，登录分支、分享文案都依赖它（QQ 复用微信包，所以不能靠条件编译判断）
  const platform = getPlatform()
  const user = useUserStore()
  user.setPlatform(platform)
  user.restore()

  console.log(`[app] launch on ${platform}`)
})

onShow(() => {
  // 从后台切回时刷新登录态有效期，避免长时间挂起后接口 401
  useUserStore().touch()
})

onError((err) => {
  console.error('[app] error', err)
})
</script>

<style lang="scss">
@use '@/styles/common.scss';
</style>
