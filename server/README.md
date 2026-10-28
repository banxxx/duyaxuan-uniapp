# 投票吧 · 后端

Cloudflare Workers + D1（SQLite）实现，和 `src/` 下的小程序端完全独立：
uni-app 只构建 `src/`，根目录 `tsconfig.json` 的 include 也只有 `src/**`，
所以这个目录不会参与小程序打包，依赖也各管各的。

```
server/
├── wrangler.toml        # Worker 配置：D1 绑定、环境变量
├── schema.sql           # 建表语句（6 张表）
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

---

## 二、本地调试

```bash
cp .dev.vars.example .dev.vars   # 填上真实 AppID / AppSecret（想测登录的话）
npm run dev                      # http://127.0.0.1:8787
```

`npm run dev` 用的是本地 D1（`.wrangler/state` 下的 sqlite 文件），
和线上库互不影响，随便删随便造。

微信开发者工具里如果要连本机接口，把 `.env.development` 的
`VITE_API_BASE_URL` 改成 `http://127.0.0.1:8787`，并在开发者工具
「详情 → 本地设置」勾选 **不校验合法域名、web-view、TLS 版本以及 HTTPS 证书**。

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
| GET | `/polls/pending` | 首页「待我投票」 |
| GET | `/polls/discover` | 发现页 |
| GET | `/polls/search` | `?keyword=` |
| POST | `/polls` | 创建，body 就是前端 draft 的形状 |
| GET | `/polls/:id` | 详情（软删除的只有发起人能看） |
| PUT | `/polls/:id` | 编辑 |
| DELETE | `/polls/:id` | 软删除 |
| POST | `/polls/:id/restore` | 从回收站恢复 |
| POST | `/polls/:id/end` | 提前结束 |
| POST | `/polls/:id/remind` | 占位，通知功能未做，收下请求返回成功 |
| POST | `/polls/:id/vote` | `{optionIds, profileInfo}` → 最新 Poll |
| DELETE | `/polls/:id/vote` | 撤回我这一票（需 `allowEdit`） |
| GET | `/polls/:id/my-vote` | 我选了哪些选项 id |
| GET | `/polls/:id/comments` | **固定返回 `[]`**，评论功能未做 |
| GET | `/polls/:id/answers` | 问卷回答列表（分页） |
| POST | `/polls/:id/answers` | 提交回答 |
| GET | `/polls/:id/my-answers` | 我的提交记录 |
| PUT | `/polls/:id/answers/:answerId` | 修改自己的回答（需 `allowEdit`） |
| GET | `/polls/:id/voters` | 投票记录 |
| GET | `/polls/:id/stats` | 发布者数据页（趋势 / 时段 / 进度） |
| GET | `/polls/:id/summary/candidates` | 问卷汇总候选选项 |
| GET | `/polls/:id/summary/unclassified` | 未归类回答 |

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

**已有票数的选项不能删**：删了那些票就凭空消失，别人看到的百分比会变。
后端会直接返回 400。

**注销账号**：账号打 `status=1` 并清空昵称头像、删掉平台绑定、软删除自己发起的投票。
投票记录和问卷回答**保留**——它们是别人投票结果的一部分，删掉会让别人的
百分比凭空变化。重新登录会创建一个全新账号。

---

## 七、目前的简化（后续要补的）

1. **首页「待我投票」** 还没有分享/邀请记录表，现在用「进行中、不是我发起的、
   我还没投」按截止时间取前 5 条顶上。做了分享链路后换成 `invites` 联表查询。
2. **问卷汇总归类** 需要语义归类（大模型或聚类），现在只做了「内容完全相同」的
   最简分组：重复出现 2 次以上的回答成为候选，其余进未归类。
   接模型只需要替换 `db/polls.ts` 里的 `summaryGroups()`。
3. **评论 / 点赞 / 通知** 未实现，接口留着（`/polls/:id/comments` 返回 `[]`）。
4. **头像上传** 走 R2 的代码还没写（`wrangler.toml` 里 R2 绑定是注释状态）。
   现在 `avatar` 字段只接受一个 URL 字符串。
5. **QQ / 抖音登录** 未实现，`/auth/login` 传这两个平台会返回 501。
   表结构（`user_platforms`）已经按多平台设计，接的时候只改 `lib/oauth.ts`。
