import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import path from 'node:path'
import pxtorpx from 'postcss-pxtorpx-pro'

/**
 * 设计稿宽 390，小程序按 750rpx 渲染。
 * 1 设计 px = 750 / 390 ≈ 1.923rpx，源码里直接写设计稿 px，构建时自动换算。
 */
const DESIGN_WIDTH = 390
const RPX_RATIO = 750 / DESIGN_WIDTH

export default defineConfig({
  plugins: [uni()],
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
