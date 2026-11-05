# dsh-drawio-chat 进展

## 目标
做一个 DSH 插件：模型生成 draw.io 图表，聊天里内联渲染本地可交互视图；不登录 draw.io、不依赖 npx/外部服务；可保存 .drawio/导出；通过 typecheck/test/build 并产出可发布材料。

## 当前状态（2026-11-06）
- 调研完成：notes/drawio/{dsh-surfaces,drawio-mcp,prior-art}.md（DSH 扩展面 / draw.io MCP 与渲染 / 市场先例）。
- 关键结论：远程 mcp.draw.io 公共无鉴权但 mermaid 不返回 XML、内联 UI 依赖 MCP Apps host（DSH 未实现）；DSH 插件可自定义 tool view 渲染任意 iframe/DOM、可落盘、可注册 *.drawio 侧栏 tab；无 ctx.mcp，富 UI 需自带 MCP 客户端。
- 命名：`dsh-drawio-chat`（npm 未占用；`dsh-drawio` 已被占用）。
- 本仓库：从 dsh-skill-workbench 复制已验证的构建/测试配置（tsdown 共用预设、vitest、tsconfig），host 侧目前只有 health 路由，client 侧只注册 locale 字典。
- 许可证：Apache-2.0（shared 构建预设来自 dsh-web Apache-2.0，已在 NOTICE.md 说明）；draw.io viewer 资产尚未加入。

## 已核验（2026-11-06）
- `pnpm install` 成功（pnpm 10.12.1 / Node 26）。
- `pnpm typecheck` 通过；`pnpm test` 4 个测试文件 / 6 个用例通过；`pnpm build` 通过（lib/index.js 0.94 kB、lib/client.js 1.94 kB）。
- host health 路由 `GET /api/dsh-drawio-chat/health` 由 host-apply 测试覆盖；client 仅注册 locale 字典。

## MVP 已实现（2026-11-06，第二提交）
- Host 工具 `drawio_diagram`（XML 校验 + 写 `<cwd>/diagrams/<slug>-<hash>.drawio` + presentationMeta）与 `drawio_reference`（远程 mcp.draw.io 参考，失败回退内置精简参考）。
- Client toolview `drawio_diagram`：sandboxed `srcdoc` iframe 内用 draw.io 官方 viewer-static 渲染；卡片含「下载 .drawio」「在 draw.io 打开」「放大/缩小」；opaque origin，不接触 GUI 源。
- 渲染方案实测结论：直接 iframe `viewer.diagrams.net` 在 headless 中不渲染；改为 **srcdoc + data-mxgraph + viewer-static（script 在 div 之后、设 mxBasePath）** 成功渲染（见 `.harness/assets/viewer-sandbox-proof.png`）；`#R` 链接格式为 `encodeURIComponent(base64(deflateRaw(encodeURIComponent(xml))))`（与官方 MCP 返回链接一致）。
- 验证：typecheck 通过；`pnpm test` 6 文件 / 14 用例通过；`pnpm build` 通过（host 9.93 kB、client 13.83 kB）。

## 收尾（2026-11-06，第三提交）
- 新增「导出 SVG」：卡片 → iframe postMessage 取回 viewer 渲染的 SVG → 父页面消毒（去 script/on* handler/javascript:）→ 下载；headless Chrome 端到端验证（1251 字节 SVG、无 `<script>`）。
- 发布材料齐：market/index.json（format 1）、market/awesome-entry.yml、PUBLISHING.md（npm/GitHub/两个市场）、CHANGELOG.md、.github/workflows/publish.yml（OIDC trusted publishing）、双语 README 安装段、本地安装脚本（--dry-run/--uninstall）。
- 安装脚本 dry-run 通过；`npm pack --dry-run` 通过（20.8 kB tarball / 66.2 kB unpacked）。
- 验证：typecheck、6 文件 / 15 用例、build 全部通过。
- 真机安装验证待用户执行：desktop profile 由 App 独占，需要 ⌘Q 后运行 `scripts/install-into-desktop-profile.mjs`；脚本已 dry-run 通过。

## 改名与 v0.2 路线（2026-11-06）
- 包/仓库改名为 `dsh-drawio-chat`（npm 未占用；「drawio + chat」兼顾搜索与差异化；备选 `dsh-draw-chat`、`dsh-diagram-ai`）。
- 新增 [docs/design-v0.2.md](../dsh-drawio-chat/docs/design-v0.2.md)：聊天优先的读/改/预览闭环，工具 = drawio_create/read/apply/undo/reference；不做右侧画布。
- typecheck / 15 tests / build 改名后全部通过。

## v0.2 进度（2026-11-06）
- 改名：仓库/包/cordis/路由/locale/安装脚本全部切到 `dsh-drawio-chat`；改名后 typecheck/test/build 通过。
- M2 模型层完成：`src/model/xml.ts`（无依赖 XML 树，保留属性顺序/未知元素/注释）+ `src/model/diagram.ts`（bare mxGraphModel、未压缩/压缩 mxfile、revision、路径策略、结构摘要）+ `src/model/ops.ts`（addNode/addEdge/setLabel/setStyle/move/remove/order，批量）。
- M3 工具完成：`drawio_create`（改名）/ `drawio_read`（结构摘要 + revision）/ `drawio_apply`（原子写 + expectRevision 冲突 + 批量 ops）/ `drawio_undo`（每文件 8 版）/ `drawio_reference`（MCP 参考）。路径限制在 session workspace 且只接受 `.drawio`。
- 测试：10 文件 / 40 用例通过；含真实 `.drawio` 互操作 fixture（来自 dsh-drawai，MIT，已记入 NOTICE）。
- M4 完成：read/apply/undo 卡片通过 loopback-only + allowlist 的 `/api/dsh-drawio-chat/diagram` 路由读回 `.drawio` 并内联渲染（不把 XML 回显进会话）；PNG 导出（canvas 光栅化，blob URL 会污染 canvas，实测改用 data: URL）；create 卡片接入同一个导出 hook。
- 版本 0.2.0：package.json、CHANGELOG、market/index.json、README 验证数字同步。
- undo 快照抽到 `src/model/undo.ts`（SnapshotStore，每文件 8 版），工具层只做调用。
- 验证：12 文件 / 45 用例；typecheck/build 通过；headless 验证 SVG（1251 字节、无 script）与 PNG（2400×1600、84,368 字节、无 taint）；`npm pack --dry-run` = 46.3 kB tarball / 159.9 kB unpacked / 24 files。

## 0.2.1（右侧栏 .drawio 预览，2026-11-06）
- 用户反馈：点开 .drawio 时右栏显示原始 XML（内置文本预览）。
- 新增 `.drawio` 侧栏 tab：extension 优先级 + pattern `**/*.drawio`；解析 `dsh-resource://file/session/<id>/<rel>`，经 loopback-only `/api/dsh-drawio-chat/open`（host 侧用 sessions.get(id).header.cwd 解析工作区根）读取文件，内联渲染；3s 轮询 + 手动刷新；下载/SVG/PNG/在 draw.io 打开。
- 客户端 inject 增加 `sidebarRightTabs` 与 `@deepseek-ai/dsh-client-ui-sidebar-right`；注册失败只 warn，不影响工具卡片。
- 验证：13 文件 / 49 用例；typecheck/build 待本轮收尾执行。

## 下一步
1. mermaid 输入：需要浏览器端 mermaid→drawio 转换；官方 drawio-mermaid 依赖 EditorUi（viewer 不带），下一版评估离线转换或让模型先调 drawio_reference 写 XML。
2. 可选：把 viewer-static 脚本 vendor 进包（约 5MB）做离线渲染；当前依赖 viewer.diagrams.net（无账号）。
3. `*.drawio` 侧栏 tab（打开/预览工作区文件）与 SVG/PNG 导出。
4. 本地安装到 desktop profile 真机验证（App 独占 profile，需退出 App）。
5. 发布材料：README 双语已完成初稿；market entry、PUBLISHING、第三方许可声明待补。
