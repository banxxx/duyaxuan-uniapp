/**
 * 平台登录换取 openid
 *
 * 现在只实现微信。QQ / 抖音的接口形状类似，等有账号了在这里加分支，
 * 路由层不用改。
 */

import { HttpError } from './response'

export interface PlatformSession {
  openid: string
  unionid?: string
}

interface WxSessionResponse {
  openid?: string
  unionid?: string
  session_key?: string
  errcode?: number
  errmsg?: string
}

/**
 * code 换 openid。
 *
 * 注意：AppSecret 只存在 Worker 的加密环境变量里（wrangler secret put），
 * 不会出现在代码、git、日志里。
 */
export async function weixinCode2Session(
  code: string,
  appid: string,
  secret: string
): Promise<PlatformSession> {
  if (!appid || !secret) {
    throw new HttpError(500, '服务端未配置微信 AppID / AppSecret')
  }

  const url =
    'https://api.weixin.qq.com/sns/jscode2session' +
    `?appid=${encodeURIComponent(appid)}` +
    `&secret=${encodeURIComponent(secret)}` +
    `&js_code=${encodeURIComponent(code)}` +
    '&grant_type=authorization_code'

  let data: WxSessionResponse
  try {
    const res = await fetch(url)
    data = (await res.json()) as WxSessionResponse
  } catch {
    throw new HttpError(502, '微信登录服务暂时不可用')
  }

  if (!data.openid) {
    // 打日志：微信的错误码是排查登录问题唯一可靠的线索
    // （40029 code 无效 / 40163 code 已用过 / 40013 appid 不对 / 40125 secret 不对）
    console.error(
      `[weixin] jscode2session failed errcode=${data.errcode} errmsg=${data.errmsg} codeLen=${code.length} appid=${appid}`
    )

    const hint =
      data.errcode === 40029
        ? '登录凭证已失效，请重试'
        : data.errcode === 40163
          ? '登录凭证已被使用，请重试'
          : data.errcode === 40013
            ? '服务端 AppID 配置错误'
            : data.errcode === 40125
              ? '服务端 AppSecret 配置错误'
              : `微信登录失败（${data.errcode ?? 'unknown'}）`
    throw new HttpError(400, hint)
  }

  return { openid: data.openid, unionid: data.unionid }
}
