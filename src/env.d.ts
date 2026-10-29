/// <reference types="@dcloudio/types" />

/** 由 vite.config.ts 的 dyx:default-avatars 插件生成：src/static/avatars/ 下的图片路径 */
declare module 'virtual:default-avatars' {
  const avatars: string[]
  export default avatars
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface ImportMetaEnv {
  /** vite 内置：开发构建为 true，用来挡开发期工具入口 */
  readonly DEV: boolean
  readonly VITE_API_BASE_URL: string
  readonly VITE_APP_ENV: 'dev' | 'test' | 'prod'
  /** 'false' 时关掉本地假数据，走真实后端 */
  readonly VITE_USE_MOCK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
