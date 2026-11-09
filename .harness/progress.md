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

## 0.2.3 修复：右侧栏 .drawio 显示原始 XML（2026-11-09）
- 用户反馈：点击打开 / 浮窗 / 右侧栏打开 `.drawio` 都显示 XML 源码，不是 draw.io 视图。
- 根因：DSH 原生 tab 类型排名 = 优先级档位 → 命中 pattern 长度 → 注册顺序。已装的 `dsh-better-sidebar`
  以 `extension` 档用 `dsh-resource://file/**`（22 字符）认领所有工作区文件；本插件原 pattern
  `**/*.drawio`（13 字符，同档位）长度更短而落败，文件落到 better-sidebar 的可编辑文本编辑器（原始 XML）。
- 修复：`src/client/index.ts` 新增 `SIDEBAR_PATTERNS = ['dsh-resource://file/**/*.drawio', '*.drawio']`
  （整地址 pattern 31 字符，同档位胜出；basename pattern 作回退）。better-sidebar 打开文件前会探测
  `sidebarRightTabs.candidates()`，命中别的 kind 时改走原生 `openResource`，因此聊天文件链接和
  better-sidebar 文件树都会进入 draw.io 原生 tab。
- 回归测试：`tests/client-apply.spec.ts` 校验注册 pattern 且长度必须大于 `dsh-resource://file/**`。
- 验证：typecheck 通过；13 文件 / 51 用例通过；build 通过（client 39.39 kB）。
- 部署：已把新 `lib/client.js`(+map) 原子替换进 `~/.dsh/profiles/desktop` 的
  `plugins/dsh-drawio-chat/lib` 与 `node_modules/dsh-drawio-chat/lib`（原文件备份为
  `*.bak-before-0.2.3`），等待 client-hmr 热更新 / 下次启动 App 生效。
- 同时生成可直接查看的 `diagrams/login-flow.png`（1458×1937）。
- 下一步：确认页面热更新后重开 `.drawio` 是否进入 draw.io tab；若页面未热更新则重启 App 或
  ⌘Q 后运行 `node scripts/install-into-desktop-profile.mjs` 重新安装 0.2.3；之后可考虑
  增加 `ctx.betterSidebar.registerFileViewer` 集成，让 better-sidebar 自身 UI 也直接提供画布。

## 0.3.0：内置场景模板 + drawio_template 工具 + 使用文档（2026-11-09）
- 用户反馈（转述自另一会话）：市场卡片看不出怎么用；draw.io 没有公开模板市场，希望内置常见场景模板，长期可做模板站。
- 模板库：`templates/` 12 个原创中文场景模板 + `templates/catalog.json`（version 1、license Apache-2.0、categories、templates[{id,file,category,title{zh,en},description{zh,en},tags}]）。分类：flowchart / architecture / data / sequence / org / swimlane。目录格式刻意做成将来站点可直接复用的 manifest。
- 新增 `src/model/templates.ts`：catalog 校验（id 唯一、file 必须 templates/ 内 *.drawio、分类存在）、`loadCatalog`、`searchTemplates`（关键词 AND + 分类）、`renderCatalogText`、`listEntry`、`templateFile`。
- 新增 host 工具 `drawio_template`：无 id → 列出/搜索（query/category）；有 id → 复制到 `diagrams/<id>.drawio`（重名自动 -2…，显式 path 不覆盖），返回 path/revision，卡片渲染；`TOOL_NAMES.template`。
- 新增 client `DrawioTemplateCard`（created → 复用 DrawioFileCard mode=template；listed → 目录文本卡）+ `TEMPLATE_TOOL_NAME`、locale keys `drawio.fileTemplate` / `drawio.templateCatalog`、`FileCardMode='template'`、`.listText` 样式。
- 文档：README/README.zh 增加 How to use / 怎么用（3 个示例提示词 + 卡片行为 + 续改/撤销 + 文件位置）与模板章节；market/index.json 描述补使用方式 + 模板库；版本 0.3.0 + CHANGELOG。
- 开发工具：`scripts/check-template.py`（结构/连线端点/兄弟重叠校验）、`scripts/preview-drawio.sh`（headless Chrome 渲染单文件预览）。
- 测试：`tests/templates.spec.ts`（catalog、文件健康、重叠、搜索）、`tests/template-card.spec.tsx`、host-apply 增加模板工具用例、client-apply 注册断言；三件套进行中。
- 并行：teammates `flow-templates`(task-1, 5 个流程模板) 与 `arch-templates`(task-2, 6 个架构/数据/组织模板) 绘制中；login 模板由 Lead 完成。
- 待办：收齐 11 个模板 → 全量测试 + 12 张渲染拼图人工检查 → build → 让用户 ⌘Q 后跑 install 脚本升级到 0.3.0（新 host 工具需重启）；下一步做模板站静态站脚手架（GitHub Pages + catalog 搜索/预览/一键在 draw.io 打开/复制提示词）。
- 2026-11-09 16:21 收尾：12 个模板全部就位（flow-templates 完成 5 个 / arch-templates 完成 6 个 / login 由 Lead 提供），`python3 scripts/check-template.py` 12/12 OK；全量测试 15 文件 / 63 用例通过；typecheck 通过；build 通过（host 68.00 kB / client 42.14 kB）；`pnpm pack --dry-run` 含 templates/。
- 人工目检：12 张模板各渲染 1400×1100 预览并拼图检查，无裁切/节点重叠/文字溢出；已知可接受项：flow-troubleshoot 2 处正交线交叉（无节点重叠），swimlane 的"结束"椭圆用相对 y=60 对齐同排矩形。
- 待用户操作：⌘Q 重启 App 使 0.3.0 生效（新的 host 工具 drawio_template 需要重启加载）；或退出后运行 `node scripts/install-into-desktop-profile.mjs` 做完整安装。

## 0.4.0：模板站 + 远程模板目录 + better-sidebar 文件查看器（2026-11-09）
- 模板站：teammate `template-site`（task-3）在 `site/` 做零依赖静态站（搜索/分类/懒加载 draw.io 预览/在 draw.io 打开/下载/复制提示词、`?q=` 可分享），`scripts/build-site.mjs` 组装 `site-dist/`，`.github/workflows/pages.yml` 部署 GitHub Pages。
- 远程目录：`drawio_template` 新增 `catalog`（HTTPS catalog.json URL）；`src/model/templates.ts` 增加 `assertRemoteUrl`（HTTPS-only、拒绝凭据/loopback/内网）、`fetchRemoteCatalog`（8s 超时、512KiB 上限、60s 缓存、file 相对 catalog 解析且必须是 .drawio）、`mergeCatalogs`（内置优先、id 去重）、`fetchTemplateXml`（远程拉取、2MiB 上限）。列表拉取失败降级为内置 + 提示；按 id 实例化远程失败直接报错。
- better-sidebar：选择 `registerFileViewer`（比单独做底部面板 tab 更易用：一个组件同时覆盖停靠/浮窗/底部工作台，`*.drawio` 默认画布，查看器下拉可切回代码编辑器，文件读取/刷新由 better-sidebar 统一管）。新增 `src/client/BetterSidebarViewer.tsx`（`exts:['drawio']`, priority 50, `fsRead`），客户端用可选 `ctx.inject(['betterSidebar'])` 注册，没装则完全无副作用、无硬依赖。
- 测试：16 文件 / 73 用例通过（新增 remote catalog 模型+host 工具用例、better-sidebar 注册与查看器渲染用例）；typecheck/build 通过；version 0.4.0；CHANGELOG/README 已更新。
- 站点数据互通：build-site 需把 catalog 的 file 重写为 `templates/<name>`，使站点 catalog 可直接作为 `drawio_template({catalog})` 的远程目录（已让 teammate 改）。
- 待办：站点最终截图/预览并发优化确认 → 0.4.0 构建后预装进 profile → 用户 ⌘Q 重启验证（新 host 工具 + 新 client 查看器需重启）。
- 2026-11-09 17:12 收尾：模板站交付（site/ + build-site + pages.yml，catalog file 重写为 templates/ 以兼容远程目录；预览 hydration 并发上限 2）；`drawio_template` 远程目录（HTTPS-only/大小超时限制/内置优先合并）；better-sidebar `registerFileViewer` 集成（画布默认、停靠/浮窗/底部工作台通用）；修复 `editorUrl()` 在 Chrome 156 CompressionStream 背压死锁（「在 draw.io 打开」会挂起），加回归测试；全量 16 文件 / 74 用例、typecheck、build 通过；版本 0.4.0。
- 站点验证：build 16 文件、本地 200/304、桌面/手机/搜索截图通过（/tmp/site-home.png 等），12 模板预览出图；站点 catalog 经插件 `validateCatalog(remote)` 校验 12/12。
- 已预装 0.4.0 到 desktop profile（lib/templates/package.json，备份 `*.bak-before-0.3.0` 之前版本 + 本次 0.4.0 覆盖）；用户 ⌘Q 重启后生效（新 host 工具 `catalog` 参数 + better-sidebar 查看器）。
- 下一步（用户侧）：仓库 Settings→Pages 选 GitHub Actions 发布模板站；`npm publish` 0.4.0 并打 tag；可选：站点暗色主题/缩略图缓存、模板扩到 20+、贡献指南。
- 2026-11-09 17:53 发布：release commit c61359d + tag v0.4.0 已推送；GitHub publish workflow 到 publish 步失败（未配置 npm trusted publisher，OIDC 不可用）；随后用户用 npm web 2FA（webauthn）手动发布成功：npm `dsh-drawio-chat@0.4.0`（17:53:45 +08，dist-tags latest=0.4.0，sha512 ddu3I7f…/NC/zWw==，41 文件 / 379.2 kB unpacked）；首跑 Pages workflow 因未开启 Pages 失败，用户已在 Settings→Pages 把 Source 设为 GitHub Actions。
- 发布后记录：market/index.json 增加 0.4.0 版本条目（publishTimestamp 1794218025）；PUBLISHING.md 状态更新为 0.4.0；.harness/publish-status.json 已更新（保持未跟踪）。待验证：Pages 站点可访问性 + 两个 workflow 最终状态；可选后续：给 npm 配 Trusted publishing（repo + publish.yml）让推 tag 自动带 provenance 发布。
- 2026-11-09 18:02 发布后核验完成：npm 0.4.0 = latest（41 文件，含 12 模板）；GitHub Pages 已启用且部署 workflow success（run 42596999885）；`https://xuedipiaofei.github.io/dsh-drawio-chat/` HTTP 200，catalog 6 分类/12 模板、`templates/flow-login.drawio` 200；CDP 实测线上页面 12 卡片、预览出图、`?q=登录` 过滤 2/12。publish workflow 仍为历史失败（未配 OIDC trusted publisher，改用 web 2FA 手动发布）——可选后续配置。详细状态：.harness/publish-status.json（本地未跟踪）。
