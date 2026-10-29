/**
 * 邀请码
 *
 * 邀请码模式的投票/问卷，参与前要先「加入」。码可能来自分享链接、
 * 小程序码，也可能要用户手动输入 —— 这里只处理「问用户要码」这一小步，
 * 三个入口（分享落地页、详情页投票、问卷填写页）共用。
 */

/** 用系统弹窗收 6 位邀请码；取消返回 null */
export function askInviteCode(): Promise<string | null> {
  return new Promise((resolve) => {
    uni.showModal({
      title: '需要邀请码',
      editable: true,
      placeholderText: '请输入 6 位邀请码',
      confirmText: '进入',
      success: (r) => resolve(r.confirm ? (r.content ?? '').trim() : null),
      fail: () => resolve(null)
    })
  })
}
