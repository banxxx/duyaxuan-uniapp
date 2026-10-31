import { getPlatform } from './platform'

/**
 * 小程序新版本提示
 *
 * 微信的发版不会立刻替换用户手上的包：只有冷启动时才会检查更新，
 * 新包下载完也要等下一次冷启动才生效。不提示的话，用户可能连续几天
 * 都跑在旧包上 —— 看到的是已经修掉的问题，反馈的也是已经改过的文案。
 *
 * 只在微信 / QQ 小程序里跑（QQ 复用微信包，getPlatform 会判成 qq）；
 * H5 刷新即最新，抖音端暂不发布，都不需要这段。
 */
export function setupUpdateManager(): void {
  const platform = getPlatform()
  if (platform !== 'weixin' && platform !== 'qq') return

  let manager: UniNamespace.UpdateManager | undefined
  try {
    manager = uni.getUpdateManager()
  } catch {
    // 老基础库没有这个 API，静默跳过
    return
  }
  if (!manager) return

  /** 一次启动只提示一次：用户点了「稍后」就不再纠缠 */
  let prompted = false

  manager.onUpdateReady(() => {
    if (prompted) return
    prompted = true
    uni.showModal({
      title: '发现新版本',
      content: '新版本已经准备好，重启小程序后生效。',
      confirmText: '立即重启',
      cancelText: '稍后',
      success: (res) => {
        if (res.confirm) manager?.applyUpdate()
      }
    })
  })

  manager.onUpdateFailed(() => {
    // 下载失败多半是网络问题，不打扰用户；下次冷启动会自动重试
    console.warn('[app] 新版本下载失败')
  })
}
