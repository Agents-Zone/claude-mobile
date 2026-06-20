# 架构

这份文档讲 Claude Mobile 内部是怎么搭起来的：手机的一条消息，怎么变成电脑上 claude-code 的一次真实操作，又怎么把结果流回手机。

## 全景

```
手机浏览器 (React + Vite)
   │  HTTP + WebSocket，经 Tailscale 私有网络
   ▼
Node 后端 (Fastify, TypeScript)
   ├─ GET  /api/roles            角色列表
   ├─ WS   /ws/:id               流式对话
   ├─ GET  /api/roles/:id/files  工作目录文件树（只读）
   └─ GET  /files/:id/*          产物文件服务
        │
        │  SessionManager：每个角色一个常驻 SDK 会话
        ▼
   claude-code 子进程  ×N（一角色一个，按 cwd 隔离）
        │  @anthropic-ai/claude-agent-sdk
        ▼
   Anthropic / claude.ai（凭证只在这台电脑）
```

整套只有一个后端进程（Fastify），它在内部为每个角色拉起并管理一个 claude-code 子进程。手机端从不直接碰 Anthropic，凭证全程留在电脑上。

## 一条消息的完整路径

1. 你在手机网页输入框发消息 → 前端通过 WebSocket 发 `{ type: "user", text }`。
2. 后端 `/ws/:id` 收到，找到对应角色的会话对象，把文本推进该会话的输入队列。
3. 这个会话背后是一个常驻的 claude-code 子进程（通过 Agent SDK 的 streaming-input 模式喂消息）。子进程在**该角色的工作目录**里真实地读文件、调工具、跑命令。
4. SDK 吐出的消息流被后端归一化成一组简单事件（见下），通过 WebSocket 推回手机。
5. 前端把事件折叠进当前角色的消息列表，流式渲染文本、可折叠地展示工具调用。
6. 如果这一轮产出了文件（比如一个 PDF），你在文件浏览器里点开，前端请求 `/files/:id/<path>`，后端从角色工作目录里把文件流回来，在手机里渲染。

## 每角色一个会话——两边都是

「切角色不打断对话」这个特性，靠的是**服务端和客户端各自为每个角色维持一个独立、常驻的会话**。

### 服务端：SessionManager（`server/src/session.ts`）

- 每个角色对应一个 `Session` 对象，内部持有一个常驻的 SDK `query()` 和一个消息输入队列（`MessageQueue`）。
- 用 SDK 的 **streaming-input** 模式：`prompt` 是一个 `AsyncIterable`，后端往里推消息，子进程就一直活着、上下文连续。这样多轮对话不用反复重启进程。
- `SessionManager` 用一个 `Map<roleId, Session>` 管所有角色。
- **新对话** = `dispose()` 掉旧会话、新建一个（不带 `resume`）。
- WebSocket 断开（比如手机切后台）时，只是把事件回调解绑，**会话本身不销毁**——重连回来还在原地。

### 客户端：store（`web/src/store.ts`）

- 镜像服务端的设计：每个角色一个 `RoleSession`，活在 React 组件树**之外**。
- 页面一加载就为**每个角色**建好会话、各自连上 WebSocket，全部在后台保持连接。
- 切角色只是切「显示哪一个」，不销毁任何连接、不清空任何消息历史。
- 组件通过 `subscribe()` 订阅自己关心的那个角色的更新。

两边对齐的结果：你跟「销售」聊到一半切去「写作」，销售那个角色的子进程只要还在生成就继续跑，事件继续在后台累积，切回来全在。

## WebSocket 协议

后端把 SDK 丰富的消息流压成一组小而稳定的事件，前端只认这几种。

**客户端 → 服务端**（`server/src/index.ts`）：

| 消息 | 作用 |
|---|---|
| `{ type: "user", text }` | 发一条用户消息 |
| `{ type: "interrupt" }` | 中断当前回合 |
| `{ type: "new" }` | 丢弃当前会话，开新对话 |

**服务端 → 客户端**（`ServerEvent`，`server/src/session.ts`）：

| 事件 | 含义 |
|---|---|
| `session` | 回合开始，带 `sessionId` |
| `text_delta` | 助手文本增量（流式） |
| `thinking_delta` | 思考过程增量 |
| `tool_use` | 工具调用开始（`id` / `name` / `input`） |
| `tool_result` | 工具结果（按 `id` 关联到对应 `tool_use`，截断摘要） |
| `result` | 回合完成，带 `usage` / `costUsd` / `numTurns` |
| `error` | 出错 |
| `idle` | 回合结束、空闲 |

## 认证（`server/src/session.ts`）

后端为子进程构造环境变量时，**删掉** `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`、`GLM_API_KEY` 这三个。这样 claude-code 会走你交互式登录的 **claude.ai (Pro/Max) 订阅**，而不是 API key 计费。

注意一个 SDK 的坑：传 `env` 时它**不会**自动合并 `process.env`，所以后端先把 `process.env` 整个铺进去，再删那三个变量。

想改成用 API key 计费的话，把这几行 `delete` 去掉即可。

## 安全边界

- **网络层**：服务绑在电脑的 Tailscale 接口（`host` 配置项），不监听公网。私有网络本身就是门禁，所以没有应用层登录。详见 README 的「为什么不用密码也安全」。
- **文件服务**（`server/src/files.ts`）：`/files/:id/*` 和文件树都做 `realpath` 越界校验——解析后的真实路径必须落在角色 `cwd` 之内，`..` 穿越和 symlink 逃逸都被拒。缺失文件返回 404，越界返回 400。
- **产物渲染**：HTML 产物在 `sandbox` iframe 里渲染、与上层页面隔离。
- **权限模式**：每个角色可单独配 `permissionMode`。`bypassPermissions` 表示模型在该角色工作目录里无确认执行任何命令——强但危险，按目录信任程度选用。

## 源码地图

| 文件 | 职责 |
|---|---|
| `server/src/config.ts` | 读 + 校验 `roles.json`，`~` 展开，自动探测 claude 路径 |
| `server/src/session.ts` | 核心：SDK 会话封装、SessionManager、事件归一化、认证 env 处理 |
| `server/src/files.ts` | 安全文件树 + 路径越界防护 |
| `server/src/index.ts` | Fastify 路由、WebSocket、产物静态服务、前端托管 |
| `web/src/store.ts` | 客户端每角色常驻会话 + 订阅 |
| `web/src/components/Chat.tsx` | 对话界面，绑定某角色的会话 |
| `web/src/components/Drawer.tsx` | 角色菜单（带实时状态） |
| `web/src/components/FileBrowser.tsx` `ArtifactView.tsx` | 文件浏览 + PDF/HTML/图片/Markdown 渲染 |
| `test/regression.mjs` | 自包含回归测试（静态层 + 活体层） |
