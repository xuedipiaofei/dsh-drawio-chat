# dsh-drawio-chat

The **chat-first** draw.io plugin for DeepSeek Harness. The model creates, inspects and edits native `.drawio` files, the chat renders them with the real draw.io viewer, and every diagram stays in the workspace.

- **No draw.io account**, no npx MCP server, no local editor install.
- Rendering happens inside a **sandboxed iframe** (opaque origin), so model-generated XML never touches the GUI origin.
- `drawio_reference` fetches draw.io's official XML reference from `https://mcp.draw.io/mcp` (no auth); **the diagram itself is never uploaded**, with a built-in condensed fallback.
- Tools only touch `.drawio` files under the session workspace; writes are atomic.

## Feature overview

**Draw** — flowcharts, architecture, UML, ER, network topologies, wireframes and other draw.io shape libraries; multi-page diagrams, layers, containers and swimlanes; LaTeX typesetting in labels.

**Edit** — `drawio_read` returns the structure by id/geometry/style plus the current revision; `drawio_apply` batches semantic ops (labels, styles, add/remove nodes and edges, move, z-order) with atomic writes and a revision-conflict guard; `drawio_undo` restores any of the last 8 versions of a file.

**View** — an interactive draw.io viewer in the transcript (zoom, pan, layers, page navigation), and `.drawio` files open in the right sidebar tab instead of showing raw XML.

**Export** — download the `.drawio`, export SVG or 2× PNG, or open it in draw.io. Files are saved under `diagrams/` and can be committed with the repository.

**Scope** — built for structural, flow, architecture and teaching diagrams. Not for 3D interactive courseware or video: those need a different plugin or pipeline.

## Install

After publishing: `dsh plugin --profile web add dsh-drawio-chat` (or install from the desktop marketplace). For a local build (the desktop app owns the `desktop` profile, quit it first):

```sh
pnpm install && pnpm build
node scripts/install-into-desktop-profile.mjs --dry-run
node scripts/install-into-desktop-profile.mjs
```

Restart the app, then ask the model to "draw a login flow diagram": it calls `drawio_create`, a draw.io viewer appears in the transcript, and the file lands under `diagrams/`. Follow-ups such as "rename the Home node" use `drawio_read` + `drawio_apply`; "undo that" uses `drawio_undo`.

## Known limits

- XML input only (`mxGraphModel`/`mxfile`); Mermaid input is not supported yet.
- The inline viewer script is loaded from `https://viewer.diagrams.net` (no account; first render needs network). An offline vendor pack is planned.
- No 3D or video output — see Scope above.

## Verification

`pnpm typecheck`, `pnpm test` (13 files / 50 tests) and `pnpm build` pass; inline rendering was verified with a headless-browser screenshot (`.harness/assets/viewer-sandbox-proof.png`), and SVG/PNG export were verified end-to-end in headless Chrome (PNG: 2400×1600 canvas, 84,368 bytes, no canvas taint).
