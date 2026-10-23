/**
 * 第三方模块类型补丁
 *
 * postcss-pxtorpx-pro 没有自带 .d.ts，也没有 DefinitelyTyped 包。
 * 这里只声明用到的那个默认导出，避免 vite.config.ts 报 TS7016。
 */
declare module 'postcss-pxtorpx-pro' {
  interface PxToRpxOptions {
    unit?: 'rpx' | 'px' | 'rem'
    transform?: (x: number) => number
    exclude?: RegExp
  }
  const plugin: (options?: PxToRpxOptions) => any
  export default plugin
}
