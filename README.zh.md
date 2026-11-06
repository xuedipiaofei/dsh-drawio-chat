# dsh-drawio-chat

DeepSeek Harness 的**聊天优先** draw.io 插件：模型创建、读取和修改原生 `.drawio` 文件，聊天里用 draw.io viewer 直接渲染，图始终留在工作区。

- **不登录 draw.io**、不需要 npx MCP server、不需要本地编辑器安装。
- 渲染发生在 **sandbox iframe** 里（opaque origin，模型生成的 XML 不会接触 GUI 源）。
- 参考文档工具 `drawio_reference` 从公开的 `https://mcp.draw.io/mcp` 取 draw.io 官方 XML 参考（无鉴权）；**图本身不上传**，取不到时回退内置精简参考。
- 工具只能读写会话工作区内的 `.drawio` 文件；写入是原子的。

## 功能一览

**画** —— 流程图、架构图、UML、ER、网络拓扑、线框等 draw.io 形状库；多页面、图层、容器与泳道；标签支持 LaTeX 排版。

**改** —— `drawio_read` 返回按 id/坐标/样式的结构摘要和当前 revision；`drawio_apply` 批量执行语义操作（标签、样式、增删节点与连线、移动、层序），原子写 + revision 冲突保护；`drawio_undo` 可回退到该文件最近 8 个版本中的任意一个。

**看** —— 聊天内嵌可交互的 draw.io viewer（缩放、平移、图层、翻页）；`.drawio` 文件在右侧栏直接预览，不再是 XML 文本。

**带** —— 下载 `.drawio`、导出 SVG 或 2× PNG、在 draw.io 打开；文件保存在 `diagrams/`，可随仓库提交。

**边界** —— 面向结构图、流程、架构和教学示意图。不做 3D 交互课件和视频，那需要另外的插件或渲染管线。

## 安装

发布到 npm 后：`dsh plugin --profile web add dsh-drawio-chat`（或桌面端在插件市场安装）。本地构建安装（桌面 App 独占 `desktop` profile，先 ⌘Q 退出）：

```sh
pnpm install && pnpm build
node scripts/install-into-desktop-profile.mjs --dry-run
node scripts/install-into-desktop-profile.mjs
```

安装后重启 App，让模型「画一张登录流程图」（`drawio_create`），聊天里出现 draw.io 视图，文件落在工作区 `diagrams/`。后续「把 Home 节点改名」走 `drawio_read` + `drawio_apply`，「撤销刚才的修改」走 `drawio_undo`。

## 已知限制

- 只接受 draw.io XML（`mxGraphModel`/`mxfile`），暂不支持 Mermaid 输入。
- 内联 viewer 脚本来自 `https://viewer.diagrams.net`（无账号要求，首次渲染需要联网）；离线包在计划中。
- 不输出 3D 或视频——见上方「边界」。

## 验证

`pnpm typecheck`、`pnpm test`（13 文件 / 50 用例）、`pnpm build` 通过；内联渲染用 headless Chrome 截图验证（`.harness/assets/viewer-sandbox-proof.png`）；SVG 与 PNG 导出都在 headless Chrome 里做了端到端验证（PNG：2400×1600 画布、84,368 字节、无 canvas taint）。
