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
          // 组件库自带的样式不做换算，避免双重缩放
          exclude: /node_modules[\\/]wot-design-uni/
        })
      ]
    }
  }
})
