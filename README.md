# mmwx-probe-themes

妙妙屋 X（MiaoMiaoWuX）独立探针的主题合集，跑在 Cloudflare Workers 上：访客访问 Worker，Worker 带着探针密钥去主控取数据，主控地址和密钥都不会暴露给访客。

基于 [jiwo-probe](https://github.com/chnnic/jiwo-probe)（上游 [mmwx-probe](https://github.com/mmwx-group/mmwx-probe)）改造，哪吒主题移植自 [nezha-dash-v1](https://github.com/hamster1963/nezha-dash-v1) v2.4.2。

## 主题

| 主题 | 说明 |
| --- | --- |
| **Nezha Dash** | 哪吒面板风格，金黄配色，圆体字 |
| **Nezha 美化** | 同一套哪吒界面的玫瑰粉玻璃皮肤：磨砂卡片、粉金地球、线路标签胶囊 |
| **Premium** | 白金/黑金卡片风格，单行紧凑顶栏 |
| **岚 · Ran** | 运维表格风，已全部汉化，首页即节点表 |

右上角有主题切换按钮（哪吒两套在顶栏第一排），访客的选择保存在自己浏览器里。

两套哪吒主题是独立构建的子工程（`themes/nezha-dash/`），通过 iframe 嵌进站点；也可以直接打开 `/themes/nezha-dash/index.html`（加 `?skin=beauty` 是美化皮肤）。

## 部署

### 1. 主控准备

在主控「系统设置 → 探针」启用探针，选择要展示的服务器和指标，生成「独立探针访问密钥」。密钥只显示一次，先保存好。

### 2. 部署到 Cloudflare

需要 Node.js 22+。

```bash
git clone https://github.com/xiao-vvv/mmwx-probe-themes.git
cd mmwx-probe-themes
npm ci
npx wrangler login

npx wrangler secret put PROBE_TOKEN      # 粘贴主控生成的探针密钥
npm run deploy                           # 构建并部署
```

然后在 Cloudflare Dashboard → Workers & Pages → `mmwx-probe` → Settings → Variables and Secrets，添加文本变量：

| 名称 | 类型 | 值 |
| --- | --- | --- |
| `MMWX_ORIGIN` | Text | 主控的 HTTPS 地址，如 `https://panel.example.com`（不带路径和结尾斜杠） |
| `PROBE_TOKEN` | Secret | 上一步已经设置过 |

保存后重新部署一次让变量生效。打开 Wrangler 输出的 `*.workers.dev` 地址，确认列表、趋势图和实时刷新都正常，最后回主控开启「仅允许独立探针访问」。

想换 Worker 名字就改 `wrangler.jsonc` 的 `name`。

也可以用 Dashboard 的 **Import a repository** 连接你 fork 的仓库自动构建：Build command 填 `npm run build`，Deploy command 填 `./scripts/deploy.sh`，变量同上。

### 3. 绑定域名（可选）

在 `wrangler.jsonc` 里取消 `routes` 的注释并填上自己的域名，或者直接在 Dashboard 的 Settings → Domains & Routes 里添加。

### 4. 全站默认主题（可选）

默认情况下，访客第一次打开看到的是主控下发的主题。如果想自己指定全站默认主题：

```bash
npx wrangler kv namespace create THEME_KV        # 记下输出的 id
npx wrangler secret put THEME_ADMIN_KEY          # 随便设一串管理口令
```

把 id 填进 `wrangler.jsonc` 里 `kv_namespaces` 那行并取消注释，重新 `npm run deploy`。

然后用浏览器打开你的站，在开发者工具 Console 执行一次：

```js
localStorage.setItem('mmwx-probe-theme-admin-key', '你的管理口令')
```

之后在这个浏览器里切换主题，会同步成全站默认主题；新访客和无痕窗口都会看到它。可选值：`premium`、`ran`、`nezha-dash`、`nezha-beauty`。

## 自定义

### 机器标签（线路 / 带宽 / IPv6）

哪吒两套主题的卡片上可以显示线路、带宽、IPv4/IPv6 标签，规则写在 `themes/nezha-dash/src/plan-tags.config.ts`，按机器名、商家名、国家代码匹配：

```ts
export const PLAN_TAG_RULES: PlanTagRule[] = [
	{ nameIncludes: ["hk-"], networkRoute: "CN2GIA,9929,CMIN2" },
	{ providerIncludes: ["examplehost"], bandwidth: "2.5Gbps" },
	{ nameRegex: /node[1-4]$/, ipv6: false },
];
```

多条线路用英文逗号分隔，卡片上会合并成一个标签。主控里没设流量上限的机器会自动显示「无限流量」。改完重新部署即可。

### 壁纸和字体

- 哪吒壁纸：`themes/nezha-dash/public/` 下的 `farm-background-*`（Nezha Dash）和 `beauty-background-*`（美化），分桌面版和手机版，同名替换即可。
- 字体：`themes/nezha-dash/public/fonts/`，Premium 主题也引用这里的字体。

## 本地开发

```bash
cp .dev.vars.example .dev.vars   # 填 MMWX_ORIGIN 和 PROBE_TOKEN
npm run dev                      # 父站
npm run dev --workspace themes/nezha-dash   # 哪吒子工程
npm run typecheck
npm run test:nezha-dash
```

Node 25 及以上版本跑测试时需要加 `NODE_OPTIONS=--no-experimental-webstorage`（Node 自带的 localStorage 会盖掉 jsdom 的那个），部分日期测试需要 `TZ=UTC`。

## 工作原理

```text
浏览器 ──HTTPS/WS──> Cloudflare Worker ──带 PROBE_TOKEN──> 妙妙屋 X 主控
```

Worker 只转发三个固定路径，不接受访客指定的上游地址，不会变成开放代理：

| 对外路径 | 主控路径 | 用途 |
| --- | --- | --- |
| `/api/probe` | `/api/public/probe-servers` | 服务器状态 |
| `/api/series` | `/api/public/probe-series` | 延迟和丢包历史 |
| `/api/stream` | `/api/public/probe-ws` | 实时 WebSocket |

另外 `/api/default-theme` 读写全站默认主题（KV），`/api/visitor` 直接返回 Cloudflare 请求头里的访客信息，不调用第三方。

## 许可

根目录沿用上游的 MSAL-1.0（见 `LICENSE`）；`themes/nezha-dash/` 沿用 nezha-dash 的 Apache-2.0（见 `themes/nezha-dash/LICENSE`、`UPSTREAM.md`）。
