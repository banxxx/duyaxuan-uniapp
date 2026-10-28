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
 * 设计稿宽 390，小程序按 750rpx 渲染。
 * 1 设计 px = 750 / 390 ≈ 1.923rpx，源码里直接写设计稿 px，构建时自动换算。
 */
const DESIGN_WIDTH = 390
const RPX_RATIO = 750 / DESIGN_WIDTH

export default defineConfig({
  plugins: [defaultAvatars(), uni()],
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
