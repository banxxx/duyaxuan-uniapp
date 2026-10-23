/**
 * token 中转站
 *
 * request 需要 token，user store 需要 request —— 直接互相 import 会形成循环依赖，
 * 打包时会被拆成循环 chunk。这里用一个极小的中间模块打断环：
 * user store 启动时把读写函数注册进来，request 只管调用。
 */

type TokenGetter = () => string
type TokenRefresher = () => Promise<boolean>

let getToken: TokenGetter = () => ''
let refresh: TokenRefresher = async () => false

export function registerAuthHooks(hooks: { getToken: TokenGetter; refresh: TokenRefresher }) {
  getToken = hooks.getToken
  refresh = hooks.refresh
}

export function currentToken(): string {
  return getToken()
}

export function tryRefreshToken(): Promise<boolean> {
  return refresh()
}
