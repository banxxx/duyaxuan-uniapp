import { defineConfig, type Plugin } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import path from 'node:path'
import fs from 'node:fs'
import pxtorpx from 'postcss-pxtorpx-pro'

/**
 * 默认头像清单：把 src/static/avatars/ 里的文件名编译成一个数组
 *
 * 小程序运行时读不到目录，打包也只会带上「代码里静态引用到」的文件，
 * 所以清单只能在构建时扫出来。做成虚拟模块而不是手写数组，
 * 是为了让换图这件事只剩「把文件丢进文件夹」一步。
 *
 * 用法：import AVATARS from 'virtual:default-avatars'
 */
const AVATAR_DIR = path.resolve(__dirname, 'src/static/avatars')
const AVATAR_ID = 'virtual:default-avatars'
const AVATAR_RESOLVED_ID = '\0' + AVATAR_ID
const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i

function defaultAvatars(): Plugin {
  return {
    name: 'dyx:default-avatars',
    resolveId(id) {
      if (id === AVATAR_ID) return AVATAR_RESOLVED_ID
    },
    load(id) {
      if (id !== AVATAR_RESOLVED_ID) return
      const files = fs.existsSync(AVATAR_DIR)
        ? fs.readdirSync(AVATAR_DIR).filter((f) => IMAGE_RE.test(f)).sort()
        : []
      return `export default ${JSON.stringify(files.map((f) => `/static/avatars/${f}`))}`
    }
  }
}

/**
 * H5 部署到 Cloudflare Pages 时用的 SPA 回退。
 *
 * 路由是 history 模式（manifest.json → h5.router.mode），直接打开或刷新
 * /pages/detail/index?id=xxx 这种深层链接，静态托管会当成文件找不到。
 *
 * 只放 _redirects 不够：Pages 会把任何以 /index 结尾的路径 308 到父目录
 * （/pages/me/index → /pages/me/），而 uni 的页面路径恰好都长这样，
 * 结果就是首页、我的、设置这些页刷新后白屏。所以用 Pages 的「高级模式」
 * _worker.js 在静态层之前接管请求：带扩展名的照常走 ASSETS，其余一律回
 * index.html 交给前端路由。只影响 h5 构建，小程序不会执行。
 */
const PAGES_WORKER = `// Cloudflare Pages 高级模式：接管全部请求，绕开 /xxx/index 的 308 重定向
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (/\\.[^/]+$/.test(url.pathname)) {
      return env.ASSETS.fetch(request)
    }
    // 用 "/" 而不是 "/index.html"：后者在 Pages 里会被 308 回 "/"，形成死循环
    return env.ASSETS.fetch(new Request(new URL('/', url), request))
  }
}
`

function spaFallback(): Plugin {
  return {
    name: 'dyx:spa-fallback',
    closeBundle() {
      if (process.env.UNI_PLATFORM !== 'h5') return
      const outDir = path.resolve(__dirname, 'dist/build/h5')
      if (!fs.existsSync(path.join(outDir, 'index.html'))) return
      fs.writeFileSync(path.join(outDir, '_worker.js'), PAGES_WORKER)
      // 高级模式下 _redirects 不生效，清掉上一次构建可能留下的
      fs.rmSync(path.join(outDir, '_redirects'), { force: true })
    }
  }
}

/**
 * 设计稿宽 390，小程序按 750rpx 渲染。
 * 1 设计 px = 750 / 390 ≈ 1.923rpx，源码里直接写设计稿 px，构建时自动换算。
 */
const DESIGN_WIDTH = 390
const RPX_RATIO = 750 / DESIGN_WIDTH

export default defineConfig({
  plugins: [defaultAvatars(), spaFallback(), uni()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  css: {
    // 设计 token 由 src/uni.scss 自动注入，页面里不必 @use
    postcss: {
      plugins: [
        pxtorpx({
          unit: 'rpx',
          // 设计稿 390 → 750rpx
          transform: (x: number) => Number((x * RPX_RATIO).toFixed(3)),
          // 没有第三方组件库了：所有样式都按 390 设计稿写 px，
          // 全部交给这里统一换算。将来若引入库，再按 node_modules 路径排除。
          exclude: /node_modules/
        })
      ]
    }
  }
})
