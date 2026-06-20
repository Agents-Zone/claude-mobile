# 推荐硬件与成本

这套东西要随时能用，就得有一台常开、网络稳定的机器在某处当后端。下面是推荐配置和大致花费。价格只是参考，会变，以实际购买为准。

## Mac mini（后端主机）

让 claude-code 一直挂着的机器。Mac mini 适合的原因：省电、安静、能 7×24 开着不管，macOS 上 claude-code 跑得顺。

- **新机**：Apple 官网 M 系列 Mac mini 起步价约 4000–5000 元人民币（约 $599 起）。日常够用，不用顶配。
- **二手 / 翻新**：M1 Mac mini 二手常见 2000–3000 元，完全够跑这套服务。
- 一台普通 Mac mini 同时挂多个角色的 claude-code 进程毫无压力。

> 不一定非得 Mac mini。任何一台你愿意常开的电脑都行（旧笔记本、Linux 小主机）。但 claude-code 在 macOS 上体验最完整，Mac mini 是省心的选择。

## Tailscale（私有网络）

把手机和 Mac mini 接进同一条加密隧道。

- **个人使用免费**。Tailscale 的 Personal 计划支持最多 100 台设备、3 个用户，对个人完全够用，**不花钱**。
- 官方定价：<https://tailscale.com/pricing>

## claude-code 订阅

实际干活的大脑。

- 用 Claude.ai 的 **Pro / Max 订阅** 登录即可，按订阅计费，不用单独的 API key。
- Pro 约 $20/月，Max 更高额度。具体看 <https://claude.com/pricing>
- 本项目默认走订阅登录（见 README 的认证说明），所以你不需要额外的 API 成本。

## 一次性 vs 持续成本

| 项目 | 类型 | 大致花费 |
|---|---|---|
| Mac mini | 一次性 | ¥2000（二手）– ¥5000（新机） |
| Tailscale | 持续 | 个人免费 |
| Claude 订阅 | 持续 | $20/月起 |
| 电费 | 持续 | Mac mini 常开很省，可忽略 |

一台二手 Mac mini + 免费 Tailscale + 你本来就有的 Claude 订阅，就能把整套跑起来。
