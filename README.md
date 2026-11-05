# dsh-drawio-inline

Render draw.io diagrams inline in DeepSeek Harness: the model calls `drawio_diagram`, the chat shows a zoomable/pannable draw.io viewer, and the `.drawio` file is saved under the workspace's `diagrams/` directory.

- **No draw.io account**, no npx MCP server, no local editor install.
- Rendering happens inside a **sandboxed iframe** (opaque origin), so model-generated XML never touches the GUI origin.
- `drawio_reference` fetches draw.io's official XML reference from `https://mcp.draw.io/mcp` (no auth); **the diagram itself is never uploaded**, with a built-in condensed fallback.
- The card offers "Download .drawio" and "Open in draw.io" (app.diagrams.net link).

## Known limits (v0.1)

- XML input only (`mxGraphModel`/`mxfile`); mermaid input is planned.
- The inline viewer script is loaded from `https://viewer.diagrams.net` (no account; first render needs network). An offline vendor pack is planned.
- No `*.drawio` sidebar tab and no SVG/PNG export yet.

## Verification

`pnpm typecheck`, `pnpm test` (6 files / 14 tests) and `pnpm build` pass; the inline rendering path was verified with a headless-browser screenshot (`.harness/assets/viewer-sandbox-proof.png`).
