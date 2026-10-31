<script setup lang="ts">
import { onLaunch, onShow, onError } from '@dcloudio/uni-app'
import { useUserStore } from '@/stores/user'
import { API_BASE } from '@/utils/api-base'
import { useMock } from '@/utils/env'
import { getPlatform } from '@/utils/platform'
import { setupUpdateManager } from '@/utils/update'

onLaunch(() => {
  // 记录运行平台，登录分支、分享文案都依赖它（QQ 复用微信包，所以不能靠条件编译判断）
  const platform = getPlatform()
  const user = useUserStore()
  user.setPlatform(platform)
  user.restore()
  // 本地缓存的是登录时的快照，启动时静默对齐一次（失败就用缓存）
  user.refreshProfile()

  // 新版本下载完成后提示重启，否则用户会一直跑在旧包上
  setupUpdateManager()

  // 真机排查时先看这一行：mock=true 说明当前包根本没连后端，
  // 此时所有操作都只写内存，云端/本地数据库都不会有数据
  console.log(`[app] launch on ${platform} · api=${API_BASE} · mock=${useMock()}`)
})

onShow(() => {
  const user = useUserStore()
  // 从后台切回时刷新登录态有效期，避免长时间挂起后接口 401
  user.touch()
  // 头像/昵称可能在另一台设备上改过，回前台时静默对齐一次
  user.refreshProfile()
})

onError((err) => {
  console.error('[app] error', err)
})
</script>

<style lang="scss">
@use '@/styles/common.scss';
</style>
