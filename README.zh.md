# dsh-drawio-inline

在 DeepSeek Harness 聊天里内联渲染 draw.io 图表的插件：模型调用 `drawio_diagram` 写出一张 draw.io 图，聊天里直接出现可缩放/平移的 draw.io 视图，同时把 `.drawio` 文件保存到当前工作区的 `diagrams/` 目录。

- **不登录 draw.io**、不需要 npx MCP server、不需要本地编辑器安装。
- 渲染发生在 **sandbox iframe** 里（opaque origin，模型生成的 XML 不会接触 GUI 源）。
- 参考文档工具 `drawio_reference` 从公开的 `https://mcp.draw.io/mcp` 取 draw.io 官方 XML 参考（无鉴权）；**图本身不上传**，取不到时回退内置精简参考。
- 卡片提供「下载 .drawio」「在 draw.io 打开」（app.diagrams.net 链接）。

## 已知限制（v0.1）

- 目前只接受 draw.io XML（`mxGraphModel`/`mxfile`），mermaid 输入在下一版处理。
- 内联查看器脚本来自 `https://viewer.diagrams.net`（无账号要求，但首次渲染需要联网）；离线离线包在计划中。
- 还没有 `*.drawio` 的侧栏 tab 与 SVG/PNG 导出。

## 验证

`pnpm typecheck`、`pnpm test`（6 文件 / 14 用例）、`pnpm build` 通过；内联渲染链路用 headless Chrome 截图验证（`.harness/assets/viewer-sandbox-proof.png`）。
