# dsh-drawio-inline 进展

## 目标
做一个 DSH 插件：模型生成 draw.io 图表，聊天里内联渲染本地可交互视图；不登录 draw.io、不依赖 npx/外部服务；可保存 .drawio/导出；通过 typecheck/test/build 并产出可发布材料。

## 当前状态（2026-11-06）
- 调研完成：notes/drawio/{dsh-surfaces,drawio-mcp,prior-art}.md（DSH 扩展面 / draw.io MCP 与渲染 / 市场先例）。
- 关键结论：远程 mcp.draw.io 公共无鉴权但 mermaid 不返回 XML、内联 UI 依赖 MCP Apps host（DSH 未实现）；DSH 插件可自定义 tool view 渲染任意 iframe/DOM、可落盘、可注册 *.drawio 侧栏 tab；无 ctx.mcp，富 UI 需自带 MCP 客户端。
- 命名：`dsh-drawio-inline`（npm 未占用；`dsh-drawio` 已被占用）。
- 本仓库：从 dsh-skill-workbench 复制已验证的构建/测试配置（tsdown 共用预设、vitest、tsconfig），host 侧目前只有 health 路由，client 侧只注册 locale 字典。
- 许可证：Apache-2.0（shared 构建预设来自 dsh-web Apache-2.0，已在 NOTICE.md 说明）；draw.io viewer 资产尚未加入。

## 已核验（2026-11-06）
- `pnpm install` 成功（pnpm 10.12.1 / Node 26）。
- `pnpm typecheck` 通过；`pnpm test` 4 个测试文件 / 6 个用例通过；`pnpm build` 通过（lib/index.js 0.94 kB、lib/client.js 1.94 kB）。
- host health 路由 `GET /api/dsh-drawio-inline/health` 由 host-apply 测试覆盖；client 仅注册 locale 字典。

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

## 下一步
1. mermaid 输入：需要浏览器端 mermaid→drawio 转换；官方 drawio-mermaid 依赖 EditorUi（viewer 不带），下一版评估离线转换或让模型先调 drawio_reference 写 XML。
2. 可选：把 viewer-static 脚本 vendor 进包（约 5MB）做离线渲染；当前依赖 viewer.diagrams.net（无账号）。
3. `*.drawio` 侧栏 tab（打开/预览工作区文件）与 SVG/PNG 导出。
4. 本地安装到 desktop profile 真机验证（App 独占 profile，需退出 App）。
5. 发布材料：README 双语已完成初稿；market entry、PUBLISHING、第三方许可声明待补。
