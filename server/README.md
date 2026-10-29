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

> **从旧版本升级**：`schema.sql` 只有 `CREATE TABLE IF NOT EXISTS`，不会给已存在的表
> 补列。之前已经建过库的，重跑 `db:remote` 后还要补这两句：
>
> ```bash
> npx wrangler d1 execute duyaxuan-db --remote \
>   --command "ALTER TABLE wx_push_prefs ADD COLUMN updated INTEGER NOT NULL DEFAULT 0"
> npx wrangler d1 execute duyaxuan-db --remote \
>   --command "ALTER TABLE answers ADD COLUMN ip TEXT"
> ```
>
> 新表 `wx_push_log` 由 `db:remote` 直接建好，不用单独处理。
>
> 结果通知的唯一索引 `ux_notifications_result` 也会在重跑 `db:remote` 时创建；
> `schema.sql` 会先按 `(user_id, poll_id)` 清掉历史重复的 `result` 通知再建索引，
> 老库直接跑一遍即可。
>
> 另外，问卷汇总的自动分组 id 现在带上了 `poll_id`，修复了不同问卷相同回答
> 互相串数据的问题。线上如果已经有旧的汇总结果，进入对应问卷的汇总页点一次
> 「重新归并」，让它按新规则重新生成即可。

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

**订阅消息模板要单独配线上的一份**：`.dev.vars` 只影响本地，线上不会自动继承。
五类共用一个模板就只配通用模板：

```bash
npx wrangler secret put WX_TMPL_NOTIFY   # 粘贴模板 ID
npx wrangler secret put WX_TMPL_FIELDS   # {"title":"thing4","content":"thing2","time":"time20"}
```

想按类型用不同模板，就分别配 `WX_TMPL_JOINED` / `WX_TMPL_COMMENT` /
`WX_TMPL_DEADLINE` / `WX_TMPL_RESULT` / `WX_TMPL_UPDATED`，没配的类型会回退到
`WX_TMPL_NOTIFY`。配完可以用 `GET /notifications/templates` 检查返回了哪几类。

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

### 连云端 D1 / R2 调试

`npm run dev` 默认只碰本地库。想让开发者工具和真机看到同一份云端数据：

| 方式 | 命令 / 配置 | 说明 |
| --- | --- | --- |
| 直接连已部署的 Worker（现在用的） | 前端 `VITE_API_BASE_URL=https://api.banxxx.cc.cd` | 不用本地服务，最接近线上；国内必须走自定义域名 |
| 远程绑定 | `npm run dev:remote` | 本地起服务、D1/R2 走云端；需要能稳定连上 Cloudflare |
| 全离线 | `npm run dev` | 最快，但数据只写本地 `.wrangler/state` |

> Wrangler 4 里 `wrangler dev --remote` 已经不起作用（绑定仍然是本地的，
> 写进去的数据在本地库里）。要用 `wrangler.toml` 的 `remote = true` 字段；
> `npm run dev` 带 `--local`，会忽略它。

云端库第一次用要先建表 / 补列：

```bash
npm run db:remote      # schema.sql 幂等，可以反复跑
npm run seed:remote    # 可选：灌演示数据，会真实写云端 D1
```

`CREATE TABLE IF NOT EXISTS` 不会给已存在的表加列。云端库如果是早期版本建的，
缺的列要手动补：

```bash
npx wrangler d1 execute duyaxuan-db --remote --command "ALTER TABLE polls ADD COLUMN invite_code TEXT"
npx wrangler d1 execute duyaxuan-db --remote --command "ALTER TABLE answers ADD COLUMN ip TEXT"
```

---

## 三、部署

```bash
npm run deploy
```

`wrangler.toml` 的 `routes` 里绑了自定义域名 `api.banxxx.cc.cd`，
部署时 Cloudflare 会自动建 DNS 记录并签发证书（首次可能要等一两分钟）。

```bash
curl https://api.banxxx.cc.cd/health   # {"ok":true,...} 就说明活了
```

> `*.workers.dev` 在境内被 DNS 污染（解析到 Facebook 的 IP），
> 所以部署后默认关掉 workers.dev，只走自定义域名。

`[triggers]` 里的 Cron 会随这次部署一起注册，但**生效可能要几分钟（最长 15 分钟）**。
在 Cloudflare 控制台 Workers → 你的 Worker → Triggers 里能看到 `*/5 * * * *`。

### 前端切换

改根目录的两个 env 文件：

```ini
# .env.development
VITE_API_BASE_URL=https://api.banxxx.cc.cd
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
| 开发联调 | 开发者工具勾选「不校验合法域名」，直接连 `api.banxxx.cc.cd` 或本机，不需要备案 |
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
| `WX_TMPL_NOTIFY` | **通用模板**，五类通知共用，通常只配这一个 |
| `WX_TMPL_JOINED` | 单独指定「有人参与 / 收到回答」，优先于通用模板 |
| `WX_TMPL_COMMENT` | 单独指定「新的评论、回复」 |
| `WX_TMPL_DEADLINE` | 单独指定「结束前 2 小时提醒」 |
| `WX_TMPL_RESULT` | 单独指定「结果公布」（参与者 + 发起人） |
| `WX_TMPL_UPDATED` | 单独指定「我参与的内容有更新」 |

**一个都不配也能跑**：只发站内消息，页面和接口照常。本地写 `.dev.vars`，
线上用 `npx wrangler secret put WX_TMPL_NOTIFY` 配置。

代码默认按这个模板格式发送：

```
活动名称{{thing4.DATA}}    ← 单选投票 / 多选投票 / 问卷收集（见 src/lib/poll-type.ts）
活动内容{{thing2.DATA}}    ← 投票 / 问卷标题
活动日期{{time20.DATA}}    ← 发送时间，格式「2026年10月29日 20:30」
```

以后加新类型（排序、打分、报名……）只要在 `src/lib/poll-type.ts` 里补一行文案，
通知链路不用动；没登记的类型会退回「投票」，不会把英文枚举发给用户。

选到的模板字段名不一样时（微信返回 `47003`），不用改代码，配一个覆盖：

```ini
WX_TMPL_FIELDS={"title":"thing4","content":"thing2","time":"time20"}
```

> 五类通知共用同一个模板时，额度也是共用的（一个模板一份额度），
> 用户点一次授权只能换一条消息，不分类型。想按类型分开授权，就配独立的模板 ID。

两个微信侧的硬规则，接的时候容易踩：

1. **一次授权、一条消息**（一次性订阅）。用户点开关/提醒按钮时弹窗同意一次，
   服务端只能发一条，发完额度归零，下次还得再点。额度存在 `wx_subscriptions`，
   上限 3 条（这是代码里的 `MAX_QUOTA`，不是微信的设置项 —— 微信侧没有可配置的额度）；
   发送前先用一条带 `remaining > 0` 的 `UPDATE` 原子扣额度，并发请求只有一个能扣到，
   不会出现两个请求都看到「还有额度」各发一条。`updated` 的每小时节流也用
   `wx_push_log` 的原子 upsert 先占位，并发编辑不会推出两条。发送返回 `43101`
   （用户拒收）时清零；网络异常或其他错误码会把刚扣的额度退回。
   长期订阅只对政务民生、医疗、交通、金融、教育等少数类目开放，一般小程序没有，
   代码按一次性订阅设计。
2. **授权必须在点击事件里同步发起**。所以前端在页面加载时先把模板 ID
   （`GET /notifications/templates`）缓存好，点击回调里只调
   `uni.requestSubscribeMessage`，中间不能插 `await`。

前端触发授权的位置（都是用户主动点击）：

| 位置 | 请求的模板 |
| --- | --- |
| 发布成功页「开启消息提醒」 | `joined` + `comment` |
| 设置 → 推送通知，打开某个开关 | 对应类型 |
| 结果页「结束前 2 小时提醒我」 | `deadline` |

### 五类通知分别什么时候发

| 类型 | 收件人 | 站内消息 | 微信推送 |
| --- | --- | --- | --- |
| `joined` | 发起人 | 每条都写 | **只在第一次参与时推** |
| `comment` | 发起人；回复时再加被回复者 | 每条都写 | 每条都推（回复是定向的） |
| `deadline` | 点了「提醒我」的人 | 一条 | 一条（结束前 2 小时；总时长不足 2 小时不提醒） |
| `result` | 发起人（投票和问卷都发）；投票参与者 | 一条，带参与人数（唯一索引兜底，重复结束 / 补发不会写两条） | 一条 |
| `updated` | 投过票 / 答过卷的人（不含发起人） | 每条都写 | 同一投票每小时最多一条 |

> 人数多时，站内消息按每批 50 条批量写入（单次最多 400 条）；微信推送受免费套餐
> 单次 50 个子请求限制，结果通知和内容更新单次最多推 4 人。结果通知没推到的用户
> 由 Cron / 下次拉通知时补；内容更新没推到的用户仍能在消息中心看到站内消息。

> 为什么参与通知只在第一次推：订阅额度是**五类共享**的，每来一票就推会迅速把
> 额度吃光，等投票结束、最该收到的「结果公布」反而发不出去。站内消息不受额度
> 影响，每条都记，用户点开消息中心就能看到全部参与记录。
>
> 微信订阅消息是「一次授权、一条消息」，设置页的开关只控制**要不要推微信服务通知**，
> 关掉不会让站内消息消失。

### 定时任务（Cron Trigger）

截止提醒和「自然到期」的结果通知需要在没人访问时也发出去，所以 Worker 导出了
`scheduled` 处理器，`wrangler.toml` 里默认配了 5 分钟一次：

```toml
[triggers]
crons = ["*/5 * * * *"]
```

免费套餐就支持（账号上限 5 个 Cron Trigger），每次触发算 1 次请求：
5 分钟一次 = 每天 288 次，对比免费额度 10 万次/天可以忽略。真正要注意的是
**免费套餐每次调用只有 50 个子请求、10ms CPU**，所以 `flushScheduled` 每轮
只取 2 个用户、每人最多 1 条结果通知、最多推 1 条提醒；处理不完的下一轮继续
（提醒发完即删，结果通知按「已有 result 通知」去重，重复跑不会重复发）。

本地手动触发：

```bash
curl http://127.0.0.1:8787/cdn-cgi/local/scheduled
```

不想用定时任务：删掉 `[triggers]` 整段再部署，`deadline` 和自然到期的
`result` 会退回「用户下次拉通知时补发」的逻辑，不会丢，只是不实时。

几个边界：

- 定时任务没部署 / 没触发时，`deadline` 和自然到期的 `result` 仍然会在用户下次拉
  `/notifications` 或 `/notifications/unread-count` 时判断并补发。
- **结果不公开**（`resultVisibility = hidden`）时，`result` 只发给发起人，
  参与者不发 —— 通知说「结果已公布」但他看不到，是假的。
- **问卷**没有「参与者结果通知」，只有发起人收到「你的问卷已结束」。
- `updated` 只比内容：标题、描述、截止时间、规则、选项标题/描述有变化才发；
  只点保存没改动不打扰。

服务端没配模板时，发布成功页不显示这个入口，设置页会说明「现在只会收到站内消息」，
其余功能不受影响。

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
| PUT | `/polls/:id` | 编辑；只传要改的字段，`rules` 里没传的规则沿用原值 |
| DELETE | `/polls/:id` | 软删除 |
| POST | `/polls/:id/restore` | 从回收站恢复 |
| POST | `/polls/:id/end` | 提前结束（不可逆；重复调用不会重复发结果通知，也不能靠改截止时间重新打开） |
| POST | `/polls/:id/remind` | 记一条截止提醒；已结束或总时长不足 2 小时返回 400 |
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
| GET | `/notifications` | 消息列表（分页），拉取时补发到期的截止提醒和结果通知 |
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
投票记录（`/voters`）和数据页（`/stats`）也走同一套判断：结果不可见时非发起人
拿不到记录，`/stats` 只允许发起人访问。只在前端隐藏等于没隐藏 —— 抓个接口就看到票数了。

匿名投票的站内通知也不带昵称（统一写「有人」），否则发起人从消息列表就能
把匿名投票人认出来，和投票记录页的规则自相矛盾。

**匿名不能事后关闭**：已经有人投票 / 回答后，把 `anonymous` 从开改成关会直接
返回 400。参与者当初是按匿名投的，不能因为发起人改规则就把身份翻出来。

**邀请码不是凭证，是门槛**：`join_method=invite` 的投票，投票/回答时后端会查
`invites` 里有没有这个人；邀请码只是让用户能写进 `invites` 的钥匙。
邀请码存在 `polls.invite_code`，一个投票一个码，发起人可分享给多人。
参与记录（`/voters`）和问卷回答（`/answers`）也只对发起人和受邀者开放，
不能靠知道 poll id 绕过邀请码读取。已经投过票 / 答过卷的人视为已受邀，
发起人中途改成邀请制不会把老参与者锁在外面。

**关掉分享的投票不进公开列表**：`allow_share=0` 时不出现在 `/polls/discover`
和搜索结果里（发起人自己仍能搜到）。关的是公开曝光，不是访问控制 ——
已经拿到链接的人仍然能打开，只是不会在发现页被陌生人刷到。

**回答和评论谁能看**：问卷回答只对发起人和提交过回答的人开放，链接模式也一样，
不能靠知道 poll id 把所有人的回答读走；邀请制投票的评论只对发起人和参与者开放，
链接模式的评论仍然公开可读。详情页遇到这两种 403 时按空列表处理，
不会把公开预览的整页打成错误态。

**结果通知不会重复**：`notifications` 上有 `(user_id, poll_id, kind)` 的部分唯一索引
（仅 `kind='result'`），写入统一用 `INSERT OR IGNORE`。并发结束投票或 Cron 补发时，
即使两个请求都查到「还没通知过」，也只有一条能写进去；只有真正写进去的请求才推送。

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
   （一次授权换一条，`wx_subscriptions` 记额度）。截止提醒（结束前 2 小时）
   和自然到期的结果通知由 `[triggers]` 的 Cron 每 5 分钟补发一轮；
   没配 Cron 或还没触发时，用户下一次拉通知也会补发。免费套餐单次调用
   子请求有限，所以 Cron 每轮只处理少量用户，剩余的下轮继续。
4. **头像 / 小程序码** 已接 R2：`POST /user/avatar`（multipart，字段 `file`）→
   `avatars/<userId>/<时间戳>.<ext>`；小程序码 → `qrcodes/<pollId>-<版本>.png`。
   两者都经 `GET /files/<key>` 对外（白名单只放这两个前缀），旧头像在新图落库后异步删除。
   头像地址只接受本人目录（防止把别人的文件设成头像后被旧图删除逻辑误删），
   读文件时按扩展名返回图片 MIME 并加 `nosniff`，不信任上传时的 Content-Type。
   上线前要先在控制台开通 R2 并 `wrangler r2 bucket create duyaxuan-avatar`。
5. **QQ / 抖音登录** 未实现，`/auth/login` 传这两个平台会返回 501。
   表结构（`user_platforms`）已经按多平台设计，接的时候只改 `lib/oauth.ts`。
