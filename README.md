# Claude Mobile

在手机上远程操作你电脑里的 Claude Code——能读写真实文件、跑命令、进到你的工作目录，不只是聊天。

## 它解决什么问题

官方的 Claude 手机端只能对话，碰不到你电脑上的东西。但你真正想在手机上做的，往往是那些需要文件和命令的活：让它改一份正在写的文档、在客户资料目录里翻东西、跑一段脚本、把结果导成 PDF 发出去。这些都要求它能进到你电脑的真实目录、有真实的读写和执行权限。

Claude Mobile 把你电脑上的 `claude-code` 暴露成一个手机网页。你在手机浏览器里发消息，电脑上的 claude-code 真的去读你的文件、改你的代码、跑你的命令，产出的 PDF / HTML / 图片直接在手机里打开看。等于把桌面那个全能力的 Claude Code 搬到了手机上。

还有一个绕不开的现实问题：**网络**。如果你人在中国、手机没翻墙，直连自己的电脑很可能被防火墙拦下来，时通时断。所以这套东西要稳定工作，需要两个前提——一台常开、网络稳定的电脑做后端，加一条能绕开封锁的私有隧道。这就是为什么下面把 Mac mini 和 Tailscale 列为推荐配置。

## 推荐配置

| 你需要 | 用什么 | 为什么 |
|---|---|---|
| 一台常开的后端电脑 | **Mac mini** | 省电、安静，能 7×24 挂着；claude-code 在 macOS 上体验最完整。一台二手 M1 就够。 |
| 手机稳定连到电脑 | **Tailscale** | 私有加密隧道，手机直连电脑、绕开常规网络封锁，个人使用免费。 |
| 干活的大脑 | **Claude 订阅** | 用 Pro / Max 订阅登录，按订阅计费，不用单独的 API key。 |

把 Mac mini 放在一个网络稳定的地方（哪怕你人在国外它也一直在线），手机通过 Tailscale 随时连回去。

硬件和价格的详细说明在 **[docs/hardware.md](docs/hardware.md)**。

## 优势

- **手机上的全能力 Claude Code**。不是阉割版聊天，是真的能读写文件、跑命令、进工作目录的那个 claude-code。
- **多角色，各管一摊**。你可以配多个角色，每个角色绑一个工作目录（比如「销售」对着客户资料目录、「写作」对着文稿目录）。每个角色自己 `.claude/` 里的 skills 和斜杠命令自动生效，像各自独立的项目。
- **切角色不打断对话**。跟一个角色聊到一半切去另一个，前一个只要还在干活就继续跑完，切回来对话都在。
- **隐私留在你电脑**。手机只跟你的电脑说话，Claude 的登录凭证从不离开电脑，服务也不暴露到公网。
- **无需密码登录**。私有网络本身就是边界（见下），省掉一层账号密码。
- **产出直接看**。生成的 PDF、HTML、图片、Markdown，在手机内置的文件浏览器里点开就渲染。
- **语音输入**。直接用手机输入法的语音听写，对消息框生效，不用额外做什么。

## 为什么不用密码也安全

这套东西没有登录页，靠的是**把网络本身当成门禁**。

Tailscale 建的是一条私有、端到端加密的隧道，只有用**你自己的 Tailscale 账号**登录过的设备才能进来。服务绑在电脑的 Tailscale 地址上，公网上根本扫不到它。所以「谁能打开这个页面」这个问题，已经被「谁的手机在我的私有网络里」回答了——再加一道密码，只是防你自己加进来的其他设备，意义不大。

如果你不用 Tailscale，任何私有网络都行（家里局域网、自建 WireGuard、别的 VPN），把服务绑到那个网络的地址上即可。**不要**直接绑到公网地址而不加你自己的鉴权和 TLS。

## 怎么用起来

需要电脑上装好 Node.js 20+ 和 `claude` 命令行工具，并且 `claude` 至少交互登录过一次。

```bash
git clone https://github.com/Agents-Zone/claude-mobile.git
cd claude-mobile
npm install
cp roles.example.json roles.json   # 然后编辑 roles.json
```

### 接入 Tailscale

1. 在**电脑**上装 Tailscale 并登录，查一下它的地址：

   ```bash
   tailscale ip -4                          # 形如 100.x.y.z
   tailscale status --json | grep DNSName   # MagicDNS 名，形如 host.tailXXXX.ts.net
   ```

2. 在**手机**上装 Tailscale（App Store / Google Play / APK），用**同一个账号**登录，打开开关。

3. 把 `roles.json` 里的 `host` 设成电脑的 Tailscale 地址（这样服务只绑在私有网络上）。

### 配置角色

编辑 `roles.json`（已在 `.gitignore` 里，你的真实工作目录不会被提交）：

```json
{
  "claudeExecutable": "",
  "host": "100.x.y.z",
  "port": 8787,
  "roles": [
    {
      "id": "writing",
      "name": "写作",
      "emoji": "✍️",
      "cwd": "~/documents/drafts",
      "model": "opus",
      "permissionMode": "acceptEdits"
    }
  ]
}
```

| 字段 | 含义 |
|---|---|
| `claudeExecutable` | `claude` 程序的绝对路径。留空 `""` 会自动用 `which claude` 找。 |
| `host` | 服务绑哪个网络接口。**推荐填电脑的 Tailscale IP**（`tailscale ip -4`），让它只在私有网络上、不上公网。本机调试可填 `127.0.0.1`。 |
| `port` | 监听端口。 |
| `cwd` | 角色的工作目录（必须已存在）。`~` 会自动展开。 |
| `permissionMode` | `acceptEdits`（自动批准文件改动，推荐）/ `default` / `bypassPermissions`（完全不检查，慎用）/ `dontAsk`。 |
| `model` | `opus` / `sonnet` / 留空走默认。 |
| `systemPromptAppend` | 可选，追加到系统提示的文字。 |
| `allowedTools` | 可选，限制可用工具；留空=全部。 |

### 启动（常驻）

```bash
bash deploy/install.sh
```

装成开机自启、崩溃自动重启的后台服务。装完在手机浏览器打开（确保 Tailscale 开着）：

```
http://host.tailXXXX.ts.net:8787      # MagicDNS 名（推荐，稳定）
http://100.x.y.z:8787                  # 或直接用 Tailscale IP
```

建议把这个地址「添加到主屏幕」，点开全屏运行，像个原生 App。

```
日志：~/Library/Logs/claude-mobile.{out,err}.log
卸载：launchctl bootout gui/$(id -u)/local.claude-mobile \
      && rm ~/Library/LaunchAgents/local.claude-mobile.plist
```

后端电脑要保持唤醒（关掉自动睡眠），睡着了就从网络上掉线、手机连不上。

## 怎么改

这个项目本身就是用 claude-code 写的。要改它——加角色逻辑、调界面、换驱动方式——**最顺手的办法就是用 claude-code 来改**。把仓库 clone 下来，在仓库目录里跑 claude-code，让它读代码、按你的需求动手。改完跑一下回归测试确认没破：

```bash
npm test          # 完整测试（会真实调用 claude-code）
npm run test:static   # 只跑静态测试（快、不花 token）
```

常见的改动点：

- **加角色**：编辑 `roles.json`，重启服务。
- **改默认认证**：默认走 Claude 订阅登录。想用 API key 计费，改 `server/src/session.ts` 里剥离环境变量那段。
- **改界面**：前端在 `web/`（React + Vite）。
- **加访问口令**：如果私有网络里不止你一个人，可以在服务端加一道 token 校验。

## 安全须知

这是个单用户工具，默认信任所有能连到端口的人。默认配置假设你在私有网络（Tailscale）里、不另设鉴权。

- 把 `host` 绑到私有网络接口；**不要**绑到公网地址而不加你自己的鉴权和 TLS。
- 文件服务有 `realpath` 越界校验，拒绝 `..` 穿越和 symlink 逃出角色目录。
- HTML 产物在 `sandbox` iframe 里渲染、隔离。
- `permissionMode: "bypassPermissions"` 会让模型在该角色的工作目录里**无确认执行任何命令**。只对你愿意完全交出控制权的目录用它；`acceptEdits` 更安全。
- 没有内置登录。多人共用同一私有网络时，自己加一道 token 校验再用。

## 给开发者

```
手机浏览器 (React)
   │  HTTP + WebSocket，经私有网络
   ▼
Node 后端 (Fastify, TypeScript)
   ├─ GET  /api/roles            角色列表
   ├─ WS   /ws/:id               流式对话（每角色一个常驻会话）
   ├─ GET  /api/roles/:id/files  工作目录文件树（只读，越界防护）
   └─ GET  /files/:id/*          产物文件服务
        │  每角色一个 Claude Agent SDK 会话，按 cwd 隔离
        ▼
   Anthropic / claude.ai（凭证只在这台电脑）
```

驱动用 [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)，streaming-input 模式让每个角色保持一个常驻进程，`resume` 续接同一会话。

内部怎么搭的、一条消息的完整路径、WebSocket 协议、源码地图，详见 **[docs/architecture.md](docs/architecture.md)**。

开发模式：

```bash
npm run dev:server   # 后端
npm run dev:web      # 前端（热更新，代理到后端）
```

回归测试 `test/regression.mjs` 会自己拉起一个隔离的测试实例（临时配置，绝不碰你的真实角色目录），跑完自动清理。静态层覆盖构建、HTTP 端点、文件服务、路径越界；活体层覆盖流式对话、cwd 隔离、多轮续接。

### 还没做的

- Codex 适配（配置层可扩展 `engine` 字段）。
- 会话历史浏览界面。
- 对话流里内嵌 HTML 渲染（目前只渲染工作目录里的文件）。

## License

MIT
