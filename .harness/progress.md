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

## 下一步
1. 用户确认渲染方案（A 本地 vendor viewer ~10–14MB / B 远程 viewer iframe ~1MB）与 MCP 角色（仅增强 reference/search / 核心 / 不接）。
2. host 工具 `drawio_diagram`：mermaid/xml → 校验 → 落盘 `<ws>/diagrams/*.drawio` → presentationMeta。
3. client toolview：本地/远程 viewer 内联渲染 + 下载/打开 draw.io。
4. 可选 MCP 客户端（get_drawio_reference/search_shapes）。
5. 发布材料（README 双语、market entry、PUBLISHING、第三方许可）。
