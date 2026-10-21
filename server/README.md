# 诊断日志的接收端

电视上的 `app/js/diag.js` 出事时（或在设置里手动）把最近的运行日志传到这里。一个
Cloudflare Worker（`diag-worker.mjs`）加一个 D1 数据库（`schema.sql`），免费额度够用。
bilibili-tizen 和 douyin-tizen 共用，按 `app` 字段分开。

## 为什么是这样

- **挂在自己的域名上，不用 `*.workers.dev`**：`workers.dev` 在大陆被墙，而第一个要靠它
  诊断的就是大陆的电视（#5）。
- **谁都能写**：地址就在公开的应用里，放什么密钥都藏不住。限住的是形状和大小、同一台电视
  一小时 20 份、全站一天 2 万份，以及 30 天的寿命。读要令牌（Worker 的 secret `READ_TOKEN`）。
- **不存 IP**，只存 Cloudflare 解析出的国家或地区和机房：「这台电视在哪个地区、拿的是哪批
  CDN 节点」正是 #5 回答不了的问题。
- **http 也收**：老电视的根证书可能和这边的证书链对不上，`diag.js` 在 https 连不上时用 http
  再试一次，记录里的 `via` 写明走的哪条。挂成 Worker 自定义域名的子域名上 http 照收
  （10-21 实测：同一份 POST，https、http 都是 200），哪怕那个域名本身的 http 会跳 https。
  换域名时重测这一条：被跳转的话 POST 变成 GET，等于没退路。

## 接口

| | |
|---|---|
| `POST /v1/upload` | `text/plain` 的 JSON：`{v:1, app, device, version, running, reason, manual, tvAt, tz, ua, lines:[…]}`，回 `{id}` |
| `GET /v1/list?device=&app=&since=&limit=` | 带 `Authorization: Bearer <令牌>`；只有元数据 |
| `GET /v1/get?id=` | 带令牌；整份，`body` 是按行拼起来的日志 |

每天的定时触发（cron）删掉 30 天前的记录。

## 部署

Worker 和 D1 库都叫 `tizen-diag`（2026-10-21 建）。
配置都在 `wrangler.toml`（自定义域名、D1 绑定、每天 04:00 UTC 的清理、关掉请求日志），在这个目录里：

```bash
npx wrangler@4 d1 create tizen-diag                                   # 只第一次；id 填进 wrangler.toml
npx wrangler@4 d1 execute tizen-diag --remote --file=schema.sql       # 幂等，加了表或索引再跑一次
npx wrangler@4 deploy                                                  # 改了 diag-worker.mjs 之后只跑这条
(umask 077; openssl rand -hex 24 > ~/.bilibili-tizen-diag-token)       # 只第一次
npx wrangler@4 secret put READ_TOKEN < ~/.bilibili-tizen-diag-token
```

接收地址写在 `app/js/diag.js` 的 `ENDPOINT` 里（douyin-tizen 的 `diag.js` 同理）；
`release.sh` 在它不是 https 地址时拒绝发布。

## 读

```bash
node tools/diag-logs.mjs                      # 最近 30 份
node tools/diag-logs.mjs --device K7QM-3XTA   # 一台电视（设置页里那个编号）
node tools/diag-logs.mjs <id>                 # 一份，全部行
```

本机冒充接收端（`zsh tools/deploy.sh --diag` 默认往它传）：`node tools/diag-local.mjs`，
读的时候 `BILI_DIAG_URL=http://localhost:8097 BILI_DIAG_TOKEN=local`。
