# 杜雅轩 · duyaxuan-uniapp

微信 / QQ / 抖音三端小程序，一套代码。设计稿 `E:/Projects/Pen/duyaxuan.pen`（96 屏）在 `src/pages` 下收敛成 36 个页面。

## 技术选型

| 层 | 选择 | 原因 |
|---|---|---|
| 框架 | uni-app (Vue 3 + Vite + TypeScript) | 一套代码编译到微信/QQ/抖音，社区与文档最完整 |
| 状态 | Pinia | 组合式写法，和 `<script setup>` 一致 |
| 样式 | SCSS + 设计 token | 设计稿的颜色/圆角/间距全部抽到 `src/styles/tokens.scss` |
| 尺寸 | `postcss-pxtorpx-pro` | 源码按 390 设计稿写 `px`，构建时自动转 `rpx`（×750/390） |
| 图标 | lucide 路径 → base64 data URI | 小程序不支持内联 `<svg>`，`<image>` 三端表现一致 |

组件全部手写（`src/components`）：设计稿的圆角、间距、字重都很具体，现成组件库改起来比写还慢，
而且少一层跨端兼容风险。`wot-design-uni` 仍留在依赖里但**没有任何页面使用它**——
它的样式还要单独做 rpx 排除（见 `vite.config.ts`），真要引入时记得先在那份排除列表里确认。

## 平台策略

**QQ 复用微信包**（方案 A）。因此：

- 构建目标只有 `mp-weixin` 和 `mp-toutiao` 两个；
- **不能用 `#ifdef MP-QQ`** —— 微信包里那段代码永远为假；
- 平台判断统一走 `src/utils/platform.ts` 的 `getPlatform()`，读 `uni.getSystemInfoSync().uniPlatform`，
  QQ 宿主里兜底再看 `app` 字段。全项目只有登录文案、授权页标题、分享提示三处依赖它。

## 目录

```
src/
├─ api/            auth.ts（登录/资料/密码/手机号/解绑）、poll.ts（投票与问卷全部接口）
├─ components/
│  ├─ base/        App* 基础件：NavBar / TabBar / Button / Sheet / Switch / Avatar / Icon / Empty / StatusBar
│  └─ business/    业务件：OptionBar / PendingCard / PollRow / TypeBadge / RuleRow / MenuRow / StepBar ...
├─ mock/           data.ts —— 与设计稿同一份假数据，USE_MOCK 打开时全部接口走它
├─ pages/          36 个页面（见下表）
├─ stores/         user / poll / draft / settings
├─ styles/         tokens.scss（设计变量）、common.scss（全局重置）
└─ utils/          request（拦截器 + 401 重登）、auth-token、format、icon、platform、share
```

## 96 屏 → 页面映射

设计稿按「状态组合」拆屏，实现上把同一页面的状态合并，用布尔量切换。

| 页面 | 设计稿 | 说明 |
|---|---|---|
| `login/index` | 01 | |
| `index/index` | 02、03、59、60、61 | 待我投票列表 + 空/加载/错误三态 |
| `search/index` | 04 | 本地搜索历史 `dyx_search_history` |
| `detail/index` | 05–12、16–20、67–70、75–76 | 一个页面覆盖「待投/已投/发起人/已结束」×「结果可见/隐藏」 |
| `detail/success` | 13 | 3 秒自动回详情 |
| `detail/result` | 21、22、23 | 结果页三种模式：可见 / 待公布 / 已关闭 |
| `detail/voters` | 14、15、73、74 | 投票记录与回答记录共用，按 `poll.type` 分三种行样式 |
| `detail/comments` | 26、79 | |
| `create/type` | 28、82 | 82 从问卷数据页进入，多一条来源条 |
| `create/content` | 29、62、83、33 | 83 的选项已由汇总带入 |
| `create/rules` | 30、31、63、87 + 32/34/35/36/37/38 | 六个弹层复用两个通用 sheet |
| `create/success` | 39、81 | **提交在 `onLoad` 里做**，避免从规则页返回时产生脏数据 |
| `creator/data` | 24、25 | 进行中 / 已结束两套 KPI |
| `creator/edit-content` | 90、93 | |
| `creator/edit-rules` | 91、94 | 已有参与后锁定选择方式/匿名/参与方式 |
| `survey/fill` | 64、65 | |
| `survey/done` | 66 | |
| `survey/mine` | 71 | 我的提交记录 |
| `survey/edit-answer` | 72 | |
| `survey/answers` | 77、78 | 截止后出现「汇总成投票」入口 |
| `summary/index` | 84 | |
| `summary/option` | 85 | |
| `summary/unclassified` | 86 | |
| `me/index` | 40 | |
| `me/created` | 41、88、89、92、95、96 | 左滑删除 + 撤销 |
| `me/joined` | 42 | |
| `settings/index` | 43、49、56 | |
| `settings/notifications` | 44、55 | `?tab=push` 进推送设置 |
| `settings/profile` | 45 | |
| `settings/account` | 46 | |
| `settings/password` | 50 | |
| `settings/phone` | 51 | |
| `settings/wechat` | 54 | 标题随宿主变（微信/QQ/抖音授权） |
| `settings/deactivate` | 53 | |
| `settings/doc` | 47、48、52 | `?type=terms\|privacy\|about` |
| `support/index` | 58 | |

**暂缓**：27 分享投票、80 分享问卷（卡片分享已有 `onShareAppMessage`，海报与跨端 H5 落地页后续补）。

## 运行

**不需要 HBuilderX。** 命令行构建 + 微信开发者工具导入就够了，
HBuilderX 只是 DCloud 的 IDE，同一套 CLI 它内部也在调。

```bash
npm install
npm run dev:mp-weixin     # 产物落在 dist/dev/mp-weixin，会持续监听改动
```

然后打开**微信开发者工具** → 导入项目 → 目录选 `dist/dev/mp-weixin`。
产物里的 `project.config.json` 由构建按 `src/manifest.json` 的 `mp-weixin.appid` 生成，
现在填的是 `wxe3bca8c1120d885d`，导入时 AppID 那一栏会自动带上，不用手填。

> **如果 AppID 栏变成了灰的、且显示「游客 APPID」**：说明产物里是 `touristappid`。
> uni 在 manifest 的 `mp-weixin.appid` 为空时会写这个占位值，而开发者工具
> 一旦读到游客 appid 就把输入框锁死。去 `src/manifest.json` 填上真实 AppID
> （或随便填一个你自己的），重新跑一次构建即可。

默认走本地假数据（`.env.development` 里 `VITE_USE_MOCK=true`），
所以**登录按钮点一下就直接进首页**，不会去调 `uni.login`。
想看真实登录时，把 `.env.development` 的 `VITE_USE_MOCK` 改成 `false`。

其它命令：

```bash
npm run dev:mp-toutiao    # 抖音：dist/dev/mp-toutiao，用抖音开发者工具导入
npm run type-check        # vue-tsc，0 错误
npm run build:mp-weixin   # 生产构建：dist/build/mp-weixin
```

**QQ 小程序**：用 QQ 开发者工具导入 `dist/*/mp-weixin` 即可，不需要单独构建。

### 关于目录的两个坑

1. **不要导入项目根目录**。根目录是 uni-app 源码（`.vue`/`.ts`），
   微信开发者工具只认编译后的 `wxml/wxss/js`，导根目录会报一堆「未找到 app.json」。
2. **每次重新构建后不用重新导入**。开发者工具监听的还是同一个目录，
   命令行这边热更新完，工具里点「编译」或直接看模拟器就行。

如果更习惯 IDE，也可以用 HBuilderX 打开项目根目录 → 运行 → 运行到小程序模拟器；
效果一样，只是多一层 GUI。

## 接口切换

`.env.development` 里 `VITE_USE_MOCK=true`，全部接口走 `src/mock/data.ts`，
不需要后端就能把 96 屏的交互跑通。接后端时把该值改成 `false`，
`src/api/*` 里的同一批函数直接打 `VITE_API_BASE_URL`，页面层一行不用改。

另外还有一道兜底（`src/utils/env.ts`）：只要 `VITE_API_BASE_URL` 还是
`example.com` 这种占位域名，就强制走 mock。这样即使误用了 `.env.production`
也不会出现「打得开但一点就报错」的情况。

登录在 mock 下返回固定账号「林小满」（`1024`），因此「我发起的」列表、
详情页的发起人视角都能直接演示。

## 后端约定（Node + TiDB）

前端只用 REST，接口清单见 `src/api/*.ts` 里 `http.get/post/put/delete` 的路径：

```
POST   /auth/login                   { platform, code } → { token, user }
PUT    /user/profile                 { nickname, bio, avatar } → user
PUT    /user/password                { oldPassword, newPassword }
POST   /user/sms-code                { phone } → { cooldown }
PUT    /user/phone                   { phone, code } → { phone }
POST   /user/unbind                  { platform } → user
POST   /user/deactivate              { password }

GET    /polls/mine | joined | discover    ?status&cursor
GET    /polls/pending                     待我投票
GET    /polls/search                       ?keyword
GET    /polls/stats                        首页汇总数字
GET    /polls/:id
POST   /polls                              创建
PUT    /polls/:id                          编辑（保留已有票数）
DELETE /polls/:id                          删除（软删）
POST   /polls/:id/restore                  撤销删除
POST   /polls/:id/end                      提前结束

POST   /polls/:id/vote                     { optionIds }
DELETE /polls/:id/vote                     撤回（允许修改选择时）
GET    /polls/:id/my-vote

GET    /polls/:id/answers                  ?cursor
POST   /polls/:id/answers                  { content }
GET    /polls/:id/my-answers
PUT    /polls/:id/answers/:aid             { content }
GET    /polls/:id/voters                   参与 / 回答记录
GET    /polls/:id/stats                    发布者数据页
GET    /polls/:id/summary/candidates       问卷汇总候选选项
GET    /polls/:id/summary/unclassified     未归类回答
POST   /polls/:id/remind                   截止时提醒我
GET    /polls/:id/comments
```

问卷的「汇总成投票」不需要额外接口：前端把候选选项写进草稿，走普通 `POST /polls`，
带上 `sourceSurveyId` 即可回溯来源。

鉴权：`Authorization: Bearer <token>`。401 时 `utils/request.ts` 会静默重登一次再重放请求。
