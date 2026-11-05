# dsh-drawio-chat

The **chat-first** draw.io plugin for DeepSeek Harness: the model calls `drawio_diagram`, the chat shows a zoomable/pannable draw.io viewer, and the `.drawio` file is saved under the workspace's `diagrams/` directory.

- **No draw.io account**, no npx MCP server, no local editor install.
- Rendering happens inside a **sandboxed iframe** (opaque origin), so model-generated XML never touches the GUI origin.
- `drawio_reference` fetches draw.io's official XML reference from `https://mcp.draw.io/mcp` (no auth); **the diagram itself is never uploaded**, with a built-in condensed fallback.
- The card offers "Download .drawio", "Export SVG" and "Open in draw.io" (app.diagrams.net link).
- **v0.2 shipped**: clicking a `.drawio` file now opens an interactive diagram tab in the right sidebar (no more raw XML); `drawio_read` (structure by id/geometry/style + revision), `drawio_apply` (batch semantic ops, atomic write, revision-conflict guard) and `drawio_undo` (last 8 versions). Read/apply/undo cards read the touched file back through the plugin's loopback-only preview route and render it inline; PNG export (2×) works too — see [docs/design-v0.2.md](docs/design-v0.2.md).

## Install

After publishing: `dsh plugin --profile web add dsh-drawio-chat` (or install from the desktop marketplace). For a local build (the desktop app owns the `desktop` profile, quit it first):

```sh
pnpm install && pnpm build
node scripts/install-into-desktop-profile.mjs --dry-run
node scripts/install-into-desktop-profile.mjs
```

Restart the app, then ask the model to "draw a login flow diagram": it calls `drawio_diagram`, a draw.io viewer appears in the transcript, and the file lands under `diagrams/`.

## Known limits (v0.1; the v0.2 roadmap is in the design doc)

- XML input only (`mxGraphModel`/`mxfile`); mermaid input is planned.
- The inline viewer script is loaded from `https://viewer.diagrams.net` (no account; first render needs network). An offline vendor pack is planned.
- No `*.drawio` sidebar tab and no PNG export yet (SVG export works).

## Verification

`pnpm typecheck`, `pnpm test` (13 files / 49 tests) and `pnpm build` pass; inline rendering was verified with a headless-browser screenshot (`.harness/assets/viewer-sandbox-proof.png`), and SVG/PNG export were verified end-to-end in headless Chrome (PNG: 2400×1600 canvas, 84,368 bytes, no canvas taint).
