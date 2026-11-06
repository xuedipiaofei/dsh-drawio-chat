# Changelog

## 0.2.2 — 2026-11-06

- Fix: `drawio_read` returned an internal `summary` field that its tool-output
  schema did not declare (`additionalProperties: false`), so the host rejected
  every read result with `"value.summary" is not a declared property`. The value
  stays inside the documented contract (`path`, `revision`, `pages`, counts) and
  the rendered structure text is built from those fields.
- Regression test: every tool result is validated against its declared output
  schema — undeclared properties, missing `required` fields and primitive type
  mismatches fail the suite.
- Docs: README feature overview (draw / edit / view / export / scope), current
  tool names (`drawio_create`), refreshed known limits; the marketplace
  description now mentions the read-edit-undo loop.
- 13 test files / 50 tests.

## 0.2.1 — 2026-11-06

- New `*.drawio` sidebar tab: clicking a diagram in the chat / file tree opens
  an interactive draw.io viewer in the right sidebar instead of the built-in
  text preview (which showed raw XML). The tab resolves
  `dsh-resource://file/session/<id>/<rel>` addresses, reads the file through the
  plugin's loopback-only `/api/dsh-drawio-chat/open` route (session cwd is
  resolved host-side), polls for changes, and offers download / SVG / PNG /
  open-in-draw.io actions.
- Sidebar tab registers as an `extension` priority type with pattern
  `**/*.drawio`, so it wins over the generic text preview for this extension.
- 13 test files / 49 tests.


## 0.2.0 — 2026-11-06

- New `src/model/` layer: dependency-free XML tree, `.drawio` carriers (bare
  `mxGraphModel`, uncompressed `mxfile`, compressed diagram payloads), SHA-1
  revision, workspace path policy, structure summary, semantic ops.
- Renamed the creation tool to `drawio_create`; added `drawio_read` (ids,
  labels, geometry, edges, revision), `drawio_apply` (batch ops — add/remove
  nodes and edges, labels, styles, moves, z-order — atomic write + optional
  `expectRevision` conflict guard) and `drawio_undo` (last 8 versions per file).
- Interop test reads a real `.drawio` produced by `dsh-drawai`; unknown cells
  (e.g. its wrapped metadata object) survive serialization.
- Client cards for `drawio_read`/`drawio_apply`/`drawio_undo`: the result card
  reads the touched file back through the plugin's loopback-only, allowlisted
  `/api/dsh-drawio-chat/diagram` route and renders it with the same sandboxed
  draw.io viewer (no XML echoed through the session log).
- PNG export (2×) in addition to SVG: the card rasterizes the sanitized viewer
  SVG through a canvas. Blob URLs taint the canvas for SVG in Chromium, so the
  raster source is a `data:` URL (verified in headless Chrome: 84,368-byte PNG).
- Version 0.2.0.


## 0.1.0 — 2026-11-06

Initial release.

- `drawio_diagram` tool: validates draw.io XML (`mxGraphModel` / `mxfile`),
  saves it under `<workspace>/diagrams/<slug>-<hash>.drawio`, and reports the
  path through `presentationMeta` for the UI.
- `drawio_reference` tool: fetches draw.io's official XML generation reference
  from the public `https://mcp.draw.io/mcp` endpoint (no authentication) with a
  built-in condensed fallback. The diagram itself is never uploaded.
- Inline chat card: sandboxed `srcdoc` iframe (`allow-scripts`, opaque origin)
  renders the diagram with draw.io's embeddable `viewer-static` runtime, with
  zoom/pan, download `.drawio`, export sanitized SVG (postMessage bridge between
  the card and the viewer iframe), open-in-draw.io, and expand/shrink actions.
- zh/en locales; Apache-2.0; third-party attribution in NOTICE.md.

### Known limits

- Draw.io XML input only (mermaid input planned).
- The viewer runtime is loaded from `https://viewer.diagrams.net` (no account,
  needs network for the first render).
- No `*.drawio` sidebar tab and no PNG export yet (SVG export works).
