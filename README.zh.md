# dsh-drawio-chat

DeepSeek Harness 的**聊天优先** draw.io 插件：模型调用 `drawio_diagram` 写出一张 draw.io 图，聊天里直接出现可缩放/平移的 draw.io 视图，同时把 `.drawio` 文件保存到当前工作区的 `diagrams/` 目录。

- **不登录 draw.io**、不需要 npx MCP server、不需要本地编辑器安装。
- 渲染发生在 **sandbox iframe** 里（opaque origin，模型生成的 XML 不会接触 GUI 源）。
- 参考文档工具 `drawio_reference` 从公开的 `https://mcp.draw.io/mcp` 取 draw.io 官方 XML 参考（无鉴权）；**图本身不上传**，取不到时回退内置精简参考。
- 卡片提供「下载 .drawio」「导出 SVG」「在 draw.io 打开」（app.diagrams.net 链接）。
- **v0.2 进行中**：`drawio_read`（按 id/坐标/样式读结构，返回 revision）、`drawio_apply`（结构化 ops 批量改图、原子写、revision 冲突保护）、`drawio_undo`（回退最近 8 版）已实现；客户端卡片与 PNG 导出待下一步；详见 [docs/design-v0.2.md](docs/design-v0.2.md)。

## 安装

发布到 npm 后：`dsh plugin --profile web add dsh-drawio-chat`（或桌面端在插件市场安装）。本地构建安装（桌面 App 独占 `desktop` profile，先 ⌘Q 退出）：

```sh
pnpm install && pnpm build
node scripts/install-into-desktop-profile.mjs --dry-run
node scripts/install-into-desktop-profile.mjs
```

安装后重启 App，让模型「画一张登录流程图」，它会调用 `drawio_diagram`，聊天里出现 draw.io 视图，文件落在工作区 `diagrams/`。

## 已知限制（v0.1，v0.2 路线见设计文档）

- 目前只接受 draw.io XML（`mxGraphModel`/`mxfile`），mermaid 输入在下一版处理。
- 内联查看器脚本来自 `https://viewer.diagrams.net`（无账号要求，但首次渲染需要联网）；离线离线包在计划中。
- 还没有 `*.drawio` 的侧栏 tab 与 PNG 导出（SVG 导出已有）。

## 验证

`pnpm typecheck`、`pnpm test`（6 文件 / 15 用例）、`pnpm build` 通过；内联渲染链路用 headless Chrome 截图验证（`.harness/assets/viewer-sandbox-proof.png`），SVG 导出链路也在 headless Chrome 里做了端到端验证（iframe 渲染 → postMessage 取 SVG → 父页面收到 1251 字节 SVG、无 `<script>`）。
