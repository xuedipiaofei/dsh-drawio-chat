# Changelog

## 0.2.0 — unreleased

- New `src/model/` layer: dependency-free XML tree, `.drawio` carriers (bare
  `mxGraphModel`, uncompressed `mxfile`, compressed diagram payloads), SHA-1
  revision, workspace path policy, structure summary, semantic ops.
- Renamed the creation tool to `drawio_create`; added `drawio_read` (ids,
  labels, geometry, edges, revision), `drawio_apply` (batch ops — add/remove
  nodes and edges, labels, styles, moves, z-order — atomic write + optional
  `expectRevision` conflict guard) and `drawio_undo` (last 8 versions per file).
- Interop test reads a real `.drawio` produced by `dsh-drawai`; unknown cells
  (e.g. its wrapped metadata object) survive serialization.
- Client cards for `drawio_read`/`drawio_apply` and PNG export are still todo.


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
