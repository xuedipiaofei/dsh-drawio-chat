## Update dsh-drawio-chat entry: scenario templates, edit/undo loop, storefront screenshots

`dsh-drawio-chat` shipped **0.4.0** (npm `latest`): a built-in catalog of 12
Chinese scenario templates (`drawio_template` tool + a static gallery site),
remote/community catalogs, a `dsh-better-sidebar` file-viewer integration, and
the previously released chat-first draw.io canvas with follow-up editing and
undo. This PR updates **only the description** of the existing entry so the
storefront line matches what the plugin now does; the screenshots are
author-declared in the repository (`screenshots.json` at the repo root), so the
site build picks them up without touching `data/screenshots.json`.

- Changed file: `data/plugins/xuedipiaofei__dsh-drawio-chat.yml`
- Upstream plugin: https://github.com/xuedipiaofei/dsh-drawio-chat
- Category: `tools`
- Version: `0.4.0` (npm `dsh-drawio-chat@0.4.0`, `dist-tags.latest = 0.4.0`)
- Template gallery: https://xuedipiaofei.github.io/dsh-drawio-chat/

### Suggested new entry

```yaml
url: https://github.com/xuedipiaofei/dsh-drawio-chat
name: xuedipiaofei/dsh-drawio-chat
category: tools
description:
  en: "Draw.io diagrams in the chat: describe a diagram and an interactive draw.io canvas appears in the transcript. 12 built-in Chinese scenario templates (login, approval, CI/CD, architecture, ER, sequence, swimlane…), follow-up edits and undo on the same .drawio file, and .drawio files previewed in the right sidebar instead of raw XML. No account, no MCP server, no local editor."
  zh: "聊天里画 draw.io：说一句需求，对话中直接出现可交互的 draw.io 图表。内置 12 个中文场景模板（登录/审批/CI-CD/架构/ER/时序/泳道…），之后可继续改图、撤销同一个 .drawio 文件，右侧栏预览不再是 XML 文本。不登录 draw.io、不需要 MCP server、不用装本地编辑器。"
icon: https://raw.githubusercontent.com/xuedipiaofei/dsh-drawio-chat/main/assets/icon-512.png
```

### Validation

- `pnpm typecheck`, `pnpm test` (16 files / 74 tests) and `pnpm build` pass in
  the plugin repository.
- `package.json` declares `dsh.bundle` (`./cordis.patch.yml`) and `dsh.client`.
- Screenshots live in the repository (`screenshots.json` →
  `docs/images/template-gallery.png`, `docs/images/templates-overview.png`,
  `docs/images/login-flow.png`), all GitHub-hosted raster images.
