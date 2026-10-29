# 投票吧 · 后端

Cloudflare Workers + D1（SQLite）实现，和 `src/` 下的小程序端完全独立：
uni-app 只构建 `src/`，根目录 `tsconfig.json` 的 include 也只有 `src/**`，
所以这个目录不会参与小程序打包，依赖也各管各的。

```
server/
├── wrangler.toml        # Worker 配置：D1 绑定、环境变量
├── schema.sql           # 建表语句（幂等，可反复执行）
├── src/
│   ├── index.ts         # 入口：挂路由、统一错误处理、CORS
│   ├── types.ts         # 行类型 / 出参类型 / Hono 上下文泛型
│   ├── lib/
│   │   ├── response.ts  # { code, data, msg } 信封 + HttpError
│   │   ├── jwt.ts       # HS256 签发与校验（WebCrypto，无依赖）
│   │   ├── oauth.ts     # 微信 code → openid
│   │   └── id.ts        # 带前缀的短 id
│   ├── middleware/auth.ts  # requireAuth / optionalAuth
│   ├── db/              # 所有 SQL 都在这里
│   │   ├── users.ts
│   │   ├── polls.ts
│   │   ├── votes.ts
│   │   └── answers.ts
│   └── routes/          # 路由层只做参数解析和组装
│       ├── auth.ts
│       ├── user.ts
│       └── polls.ts
└── .dev.vars.example    # 本地调试用的环境变量样例
```

---

## 一、一次性准备

### 1. 建 D1 数据库

```bash
cd server
npm install
npx wrangler login          # 浏览器里授权 Cloudflare 账号
npx wrangler d1 create duyaxuan-db
```

命令会打印一段 `[[d1_databases]]` 配置，把其中的 `database_id`
复制到 `wrangler.toml` 里替换 `REPLACE_WITH_YOUR_DATABASE_ID`。

然后建表：

```bash
npm run db:remote    # 建线上库
npm run db:local     # 建本地库（wrangler dev 用）
```

### 2. 配密钥

**这三个值不要写进代码、不要发给我、不要提交 git。** 直接在你自己的终端里执行：

```bash
npx wrangler secret put WX_APPID
npx wrangler secret put WX_SECRET
npx wrangler secret put JWT_SECRET
```

- `WX_APPID` / `WX_SECRET`：微信公众平台 → 开发 → 开发管理 → 开发设置里的 AppID / AppSecret。
  AppSecret 只在生成时显示一次，丢了只能重置。
- `JWT_SECRET`：随便一串 32 位以上的随机字符串。可以用
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 生成。
  **改了它，所有已登录用户的 token 立刻失效**，需要重新登录。

这些值会写进 Cloudflare 的加密环境变量，`wrangler deploy` 时注入，
本地 `wrangler dev` 则读 `.dev.vars`（已在 `.gitignore` 里）。

小程序码还要注意两点：

- **不要开微信后台的「IP 白名单」**。`cgi-bin/token` 要拿 `access_token`，
  Cloudflare Worker 的出口 IP 每次都可能不同，开了白名单就会报 `40164`。
- `WX_ENV_VERSION`（本地写在 `.dev.vars`，线上可不配）：生成的码要跳到哪个版本，
  `release`（默认）/ `trial` / `develop`。开发期用 `develop`，因为 `release`
  指向的线上版本还不存在，扫码只会提示「小程序未发布」。
  注意：**这个版本本身得先存在**。没在开发者工具里「上传」过任何版本，
  扫 `develop` 会提示「开发版不存在」；上传了但没在后台设为体验版，
  扫 `trial` 会提示「体验版不存在」。上传一次是最省事的做法。

---

## 二、本地调试

```bash
cp .dev.vars.example .dev.vars   # 填上真实 AppID / AppSecret（想测登录的话）
npm run db:local                 # 建本地表（schema.sql 幂等，可以反复跑）
npm run seed                     # 灌演示数据：4 个主账号 + 投票人 + 7 个投票/问卷
npm run dev                      # http://127.0.0.1:8787
```

`npm run dev` 用的是本地 D1（`.wrangler/state` 下的 sqlite 文件），
和线上库互不影响，随便删随便造。`npm run seed` 只写本地库，重复执行会先清掉
上一批 `seed*` 数据再灌，不会碰你自己登录的账号。

**开发期切换测试账号**

`.dev.vars` 里打开 `DEV_LOGIN=true`（默认示例文件里是 false），
后端会多出 `GET /auth/dev-accounts` 和 `POST /auth/dev-login` 两个接口；
线上不配置这个变量，这两个接口就是 404。

小程序里在「设置 → 关于我们」**长按**，会列出全部账号：
林小满（发起人视角，有投票/问卷/评论/通知）、周子墨、陈一、林夏、以及你自己。
切完会 reLaunch 回首页，`我发起的 / 我参与的 / 数据页 / 汇总` 立刻换成对应身份的数据。

> 改了 `.dev.vars` 必须重启 `npm run dev`。Windows 上旧的 `workerd.exe` 有时不会
> 跟着父进程退出，会继续占着 8787 用旧配置响应；遇到「改了环境变量没生效」，
> 先确认端口上只剩一个 `workerd.exe`。

微信开发者工具里如果要连本机接口，把 `.env.development` 的
`VITE_API_BASE_URL` 改成 `http://127.0.0.1:8787`，并在开发者工具
「详情 → 本地设置」勾选 **不校验合法域名、web-view、TLS 版本以及 HTTPS 证书**。

**真机调试**（手机预览 / 体验版）连本机接口要换一套配置，`127.0.0.1` 在手机上
指的是手机自己：

1. 手机和电脑连同一个 Wi-Fi，记下电脑的局域网 IP（`ipconfig` 里的 IPv4）
2. 新建 `.env.development.local`（已在 `.gitignore` 里）：
   ```bash
   VITE_API_BASE_URL=http://192.168.x.x:8787
   VITE_USE_MOCK=false
   ```
3. 后端要监听所有网卡：`npx wrangler dev --port 8787 --ip 0.0.0.0`
4. 改完 `.env.development.local` 要重启 `npm run dev:mp-weixin`
5. 手机上打开「调试」（vConsole），否则微信会按合法域名校验拦掉 http 请求

另外，**开发版 / 体验版是「上次上传的那一刻」的快照**，本地改代码不会同步过去。
真机上看到的是旧界面（甚至个别页面空白）时，先重新「预览」或重新「上传」，
再判断是不是代码问题。

---

## 三、部署

```bash
npm run deploy
```

部署完会得到一个 `https://duyaxuan-api.<你的子域>.workers.dev` 地址，
`curl https://.../health` 能看到 `{"ok":true}` 就说明活了。

### 前端切换

改根目录的两个 env 文件：

```ini
# .env.development
VITE_API_BASE_URL=https://duyaxuan-api.<你的子域>.workers.dev
VITE_USE_MOCK=false
```

`.env.production` 同理。**`VITE_USE_MOCK` 必须是 `false`** ——
`src/utils/env.ts` 里的判断是 `VITE_USE_MOCK !== 'false'` 就走 mock，
不写或者写成 `0` 都会继续用假数据。

---

## 四、域名 / 微信小程序后台（这里有个绕不开的坎）

小程序发请求的域名有硬性要求：**HTTPS + 已备案 + 在小程序后台配置过**。
`*.workers.dev` 没法备案，所以：

| 阶段 | 怎么做 |
| --- | --- |
| 开发联调 | 开发者工具勾选「不校验合法域名」，直接连 `workers.dev` 或本机，不需要备案 |
| 真机 / 体验版 | 需要已备案域名，且在小程序后台「开发 → 开发管理 → 服务器域名」里按**完整主机名**逐个添加（不支持通配符，最多 20 个） |
| 正式上线 | 同上；如果要做境内备案，通常得有一台境内服务器作为接入商 |

也就是说：**开发和演示阶段这套完全够用，上线前必须解决备案域名**。
到时候有两条路——把域名备案挂到境内服务器上做反向代理转发到 Worker，
或者整体迁到境内云（腾讯云 CloudBase / 阿里云函数计算），
`db/` 这一层是唯一要动的地方，路由和前端都不用改。

### 小程序码 / 海报

生成小程序码**不需要域名**：`wxacode.getUnlimited` 是服务端出网调用，
Worker 直接请求 `api.weixin.qq.com` 就行，和请求合法域名是两码事。
真正卡人的是「扫码之后」：

| 阶段 | 能不能扫 | 说明 |
| --- | --- | --- |
| 开发者工具 | 能 | 模拟扫码会带 `scene` 进页面，勾了「不校验合法域名」就能跑通 |
| 真机 + 开发版 | 能 | 码指向 `develop`（`WX_ENV_VERSION=develop`），只有开发者本人/项目成员能扫 |
| 真机 + 体验版 | 能 | 码指向 `trial`，并且只有**体验成员**能打开 |
| 真机 + 正式版 | 能 | 上线后 `WX_ENV_VERSION` 不配（默认 `release`），所有人都能开 |
| 分享卡片给好友 | 体验版可以 | 好友也得是体验成员，否则提示未发布 |

码本身由 `GET /polls/:id/qrcode` 生成，落在 R2 的 `qrcodes/<pollId>-<版本>.png`，
按「投票 + 版本」缓存。发起人关掉「允许分享」后，非发起人请求返回 403。

### 订阅消息（服务通知）

站内消息只有打开小程序才看得到。想让用户不进小程序也收到提醒，
要在微信后台「功能 → 订阅消息」里选好模板，把模板 ID 配到环境变量：

| 变量 | 用途 |
| --- | --- |
| `WX_TMPL_JOINED` | 有人参与了你的投票 / 收到新的回答 |
| `WX_TMPL_COMMENT` | 新的评论、回复 |
| `WX_TMPL_DEADLINE` | 「截止时提醒我」到点提醒 |
| `WX_TMPL_RESULT` | 预留，目前没有业务产生这类通知 |

**一个都不配也能跑**：只发站内消息，页面和接口照常。本地写 `.dev.vars`，
线上用 `npx wrangler secret put WX_TMPL_JOINED` 等逐个配置。

模板字段默认按 `thing1`（标题）/ `time2`（时间）/ `thing3`（备注）发送。
选到的模板字段名不一样时（微信返回 `47003`），不用改代码，配一个覆盖：

```ini
WX_TMPL_FIELDS={"title":"thing1","time":"time2","remark":"thing3"}
```

两个微信侧的硬规则，接的时候容易踩：

1. **一次授权、一条消息**。用户点开关/提醒按钮时弹窗同意一次，服务端只能发一条，
   发完额度归零，下次还得再点。额度存在 `wx_subscriptions`，上限 3 条；
   发送返回 `43101`（用户拒收）时清零，避免每次白调接口。
2. **授权必须在点击事件里同步发起**。所以前端在页面加载时先把模板 ID
   （`GET /notifications/templates`）缓存好，点击回调里只调
   `uni.requestSubscribeMessage`，中间不能插 `await`。

---

## 五、接口清单

前缀和 `src/api/*.ts` 一一对应，没有额外的版本号。

### 登录 / 账号

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/login` | `{platform, code}` → `{token, user}`；目前只接受 `weixin` |
| GET | `/user/profile` | 当前用户资料 |
| PUT | `/user/profile` | 改 `nickname` / `avatar` / `bio` |
| POST | `/user/deactivate` | 注销账号（前端弹二次确认，服务端只校验登录态） |
| POST | `/user/unbind` | `{platform}` 解绑，返回 `bound: false` |

### 投票 / 问卷

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/polls/stats` | 我发起的：进行中 / 已结束 / 总参与 |
| GET | `/polls/mine` | 我发起的，`?status=all\|ongoing\|ended&cursor=` |
| GET | `/polls/joined` | 我参与过的 |
| GET | `/polls/pending` | 首页「待我投票」，读 `invites`（谁分享给了我） |
| GET | `/polls/discover` | 发现页 |
| GET | `/polls/search` | `?keyword=` |
| POST | `/polls` | 创建，body 就是前端 draft 的形状 |
| GET | `/polls/:id` | 详情（软删除的只有发起人能看） |
| PUT | `/polls/:id` | 编辑 |
| DELETE | `/polls/:id` | 软删除 |
| POST | `/polls/:id/restore` | 从回收站恢复 |
| POST | `/polls/:id/end` | 提前结束 |
| POST | `/polls/:id/remind` | 记一条截止提醒，截止后第一次拉通知时补发 |
| GET | `/polls/:id/qrcode` | 小程序码（`→ /files/qrcodes/...png`），关掉分享后非发起人 403 |
| GET | `/polls/:id/invite-code` | 邀请码，仅发起人 |
| POST | `/polls/:id/join` | 分享落地：邀请码模式校验码，链接模式只记来源 |
| POST | `/polls/:id/vote` | `{optionIds, profileInfo}` → 最新 Poll |
| DELETE | `/polls/:id/vote` | 撤回我这一票（需 `allowEdit`） |
| GET | `/polls/:id/my-vote` | 我选了哪些选项 id |
| GET | `/polls/:id/comments` | 评论列表（`liked` / `isMine` 按当前用户给） |
| POST | `/polls/:id/comments` | `{content, replyToId?}` 发评论（受 `allowComment` 控制） |
| DELETE | `/polls/:id/comments/:commentId` | 作者本人或发起人删除 |
| POST / DELETE | `/polls/:id/comments/:commentId/like` | 点赞 / 取消，返回 `{liked, likeCount}` |
| GET | `/polls/:id/answers` | 问卷回答列表（分页） |
| POST | `/polls/:id/answers` | 提交回答 |
| GET | `/polls/:id/my-answers` | 我的提交记录 |
| PUT | `/polls/:id/answers/:answerId` | 修改自己的回答（需 `allowEdit`） |
| GET | `/polls/:id/voters` | 投票记录 |
| GET | `/polls/:id/stats` | 发布者数据页（趋势 / 时段 / 进度） |
| GET | `/polls/:id/summary/candidates` | 问卷汇总候选选项 |
| GET | `/polls/:id/summary/unclassified` | 未归类回答 |
| GET | `/polls/:id/summary/options/:optionId` | 选项详情 + 归在它下面的回答 |
| POST | `/polls/:id/summary/options` | `{title, desc?, answerIds?}` 新建选项 |
| PUT / DELETE | `/polls/:id/summary/options/:optionId` | 改 / 删（删掉后回答回未归类） |
| POST | `/polls/:id/summary/options/:optionId/answers` | `{answerIds}` 归入已有选项 |
| DELETE | `/polls/:id/summary/options/:optionId/answers/:answerId` | 移出选项 |
| POST | `/polls/:id/summary/ignore` | `{answerIds}` 忽略（不进汇总） |
| POST | `/polls/:id/summary/remerge` | 清掉整理结果，按原文重新分组 |

> 汇总读写都要求「登录 + 是这份问卷的发起人」，回答里是参与者写的内容，不公开。

### 通知 / 反馈

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/notifications` | 消息列表（分页），拉取时会补发到期的「提醒我」 |
| GET | `/notifications/unread-count` | 未读数，给「我的」铃铛红点用 |
| POST | `/notifications/read` | `{ids?}`，不传就是全部已读，返回剩余未读数 |
| GET | `/notifications/templates` | 已配置的订阅消息模板（kind → template_id），没配就是 `{}` |
| POST | `/notifications/subscribe` | `{templateIds, prefs?}`，同意的模板各 +1 次发送额度 |
| POST | `/notifications/prefs` | `{prefs}`，同步推送开关（服务端据此决定发不发） |
| POST | `/feedback` | `{content, contact?}`，允许未登录提交 |

通知分两层：站内消息（`notifications` 表）在参与、回答、评论、回复、截止提醒时
始终写一条；订阅消息在「配了模板 + 用户授权过 + 还有额度」时才额外推一条。
两层互不影响，推送失败只打日志，不会让投票/评论接口报错。

统一响应体：

```json
{ "code": 0, "data": ... }              // 成功
{ "code": 400, "data": null, "msg": "..." }  // 失败，HTTP 状态码同步为 400
```

失败时 HTTP 状态码是真的（不是 200 + code:500）—— 前端的 401 自动重登依赖这一点。

---

## 六、几个设计决定

**token 过期怎么办**：没有 refresh 接口。前端 `request.ts` 收到 401 会重新
`uni.login` 换 code 再调 `/auth/login`，拿到的就是新 token。所以这里只签 7 天。

**「每人只能投一次」**：靠 `ux_votes_poll_user` 唯一索引，不是先查后写。
并发下先查后写会双写成功，唯一索引不会。

**计数为什么是冗余字段**：列表页每行要显示「42 人已投」，每次都 `count(*)` 太贵。
`voter_count` / `answer_count` / `options.votes_count` 在写入时和主记录放在
同一个 `batch()` 里更新，不会写歪。

**匿名 ≠ 不存 user_id**：`votes` / `answers` 表始终存 `user_id`（「我投过没」
「我的选择」都要用它），匿名只在出参时把身份字段摘掉。所以**改成匿名不会
让历史数据变得不可追溯**，这点要心里有数。

**规则在服务端生效，不只是前端藏**：`resultVisibility` 不允许看结果时，
接口直接把 `options[].votes` 置 0；`hideVoterCount` 会把 `voterCount` 置 0（发起人除外）；
`shuffleOptions` 按「投票 + 查看者」做稳定打乱，刷新不会换顺序，发起人看原顺序。
只在前端隐藏等于没隐藏 —— 抓个接口就看到票数了。

**邀请码不是凭证，是门槛**：`join_method=invite` 的投票，投票/回答时后端会查
`invites` 里有没有这个人；邀请码只是让用户能写进 `invites` 的钥匙。
邀请码存在 `polls.invite_code`，一个投票一个码，发起人可分享给多人。

**已有票数的选项不能删**：删了那些票就凭空消失，别人看到的百分比会变。
后端会直接返回 400。

**注销账号**：账号打 `status=1` 并清空昵称头像、删掉平台绑定、软删除自己发起的投票。
投票记录和问卷回答**保留**——它们是别人投票结果的一部分，删掉会让别人的
百分比凭空变化。重新登录会创建一个全新账号。

---

## 七、目前的简化（后续要补的）

1. **参与方式只有两档**：`link`（持链接可投）和 `invite`（需要 6 位邀请码）。
   老数据里的 `group` / `private` 在读取时都按 `invite` 处理。
   邀请码存在 `polls.invite_code`，分享链接和小程序码里会带上；`invites` 表记录
   「谁把这条投票带给了谁」，首页「待我投票」直接读它。
2. **问卷汇总归类** 需要语义归类（大模型或聚类），现在只做了「内容完全相同」的
   最简分组：重复出现 2 次以上的回答成为候选，其余进未归类。
   接模型只需要替换 `db/polls.ts` 里的 `summaryGroups()`。
3. **通知**：站内消息始终写；订阅消息要配模板 ID，并且用户逐次授权
   （一次授权换一条，`wx_subscriptions` 记额度）。没有定时任务 ——
   「提醒我」在截止后第一次拉通知列表时补发，站内消息和订阅消息一起发。
   真要做定时，加一个 `scheduled` handler 跑同一段 `flushDueReminders` 即可。
4. **头像 / 小程序码** 已接 R2：`POST /user/avatar`（multipart，字段 `file`）→
   `avatars/<userId>/<时间戳>.<ext>`；小程序码 → `qrcodes/<pollId>-<版本>.png`。
   两者都经 `GET /files/<key>` 对外（白名单只放这两个前缀），旧头像在新图落库后异步删除。
   上线前要先在控制台开通 R2 并 `wrangler r2 bucket create duyaxuan-avatar`。
5. **QQ / 抖音登录** 未实现，`/auth/login` 传这两个平台会返回 501。
   表结构（`user_platforms`）已经按多平台设计，接的时候只改 `lib/oauth.ts`。
