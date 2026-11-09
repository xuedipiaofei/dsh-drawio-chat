# Changelog

## 0.4.0 — 2026-11-09

- New **template gallery** (`site/`): a dependency-free static site over the
  same catalog — search, category filters, lazy draw.io previews, and
  per-template *Open in draw.io / Download .drawio / Copy prompt* actions
  (`?q=` makes a search shareable). `scripts/build-site.mjs` assembles
  `site-dist/`; `.github/workflows/pages.yml` deploys it to GitHub Pages.
- `drawio_template` now accepts **`catalog`**, the public HTTPS URL of another
  `catalog.json` (e.g. the gallery's or a community one). Remote entries are
  merged after the built-in ones, with HTTPS-only URLs, loopback/private-host
  rejection, 8 s timeouts and size caps (512 KiB catalog / 2 MiB diagram). A
  broken remote catalog degrades a listing to the built-ins with a warning;
  instantiating an explicit remote id reports the failure.
- New **dsh-better-sidebar integration**: when that plugin is present the
  canvas registers as a file viewer (`registerFileViewer`, extension `drawio`,
  priority 50, `fsRead`). It becomes the default `*.drawio` preview in its
  editor — docked panes, floating panes and the bottom workbench alike — with
  the code editor still available from the viewer dropdown. This uses the
  file-viewer extension point instead of a dedicated bottom-panel tab: one
  component covers every surface and better-sidebar keeps file I/O and the
  `Open with` flow centralized. No hard dependency: without better-sidebar
  nothing is registered.
- Fix: `editorUrl()` ("Open in draw.io") could hang forever on browsers where
  `CompressionStream` applies backpressure before the readable side is
  consumed (observed in Chrome 156): the write was awaited before anyone read
  the stream. The readable side is now drained concurrently, with a regression
  test built on a backpressure-simulating stream.
- Docs: README gained gallery/community-catalog/better-sidebar sections;
  known limits cover remote-catalog trust.
- Includes the 0.3.0 built-in template catalog + `drawio_template` tool and the
  0.2.3 `.drawio` sidebar-tab claim fix.

## 0.3.0 — 2026-11-09

- New **built-in scenario template catalog**: 12 original, Chinese-labeled
  `.drawio` templates under `templates/` with a bilingual `catalog.json`
  manifest — login flow, approval workflow, checkout flow, CI/CD pipeline,
  incident troubleshooting tree, microservices architecture, web deployment,
  ETL pipeline, e-commerce ER model, login sequence diagram, team org chart,
  and a support-ticket swimlane.
- New **`drawio_template` tool**: list/search the catalog (`query`, `category`),
  instantiate a template into the workspace (fresh file name per call; an
  explicit `path` is never overwritten), then edit it with
  `drawio_read` / `drawio_apply`. The tool renders as the diagram card when a
  file was created and as a compact catalog card when it only listed matches.
- Docs: README gained a **How to use** section (three example prompts, what the
  card is and what its buttons do, how follow-up edits work) and a templates
  section; the marketplace description now says what to ask for and mentions
  the template catalog.
- Dev tooling: `scripts/check-template.py` validates structure, edge endpoints
  and sibling overlap; `scripts/preview-drawio.sh` renders one file with
  headless Chrome. The catalog test runs the same checks over every template.
- Includes the `0.2.3` fix for `.drawio` files opening as raw XML when
  `dsh-better-sidebar` is installed (longer whole-address tab claim).

## 0.2.3 — 2026-11-09

- Fix: with `dsh-better-sidebar` installed, opening a `.drawio` file showed raw
  XML in that plugin's editable text editor instead of the draw.io viewer. The
  native tab-type registry ranks claimants by priority band, then by the length
  of the matched pattern; better-sidebar claims every workspace file with
  `dsh-resource://file/**` (22 chars) in the `extension` band, so the previous
  `**/*.drawio` pattern (13 chars, same band) lost the claim. The viewer now
  registers the longer whole-address pattern
  `dsh-resource://file/**/*.drawio` (31 chars), with `*.drawio` kept as a
  fallback. better-sidebar's file tree probes the registry's candidates and
  routes the open to this native tab, so `.drawio` files reach the viewer from
  both the chat and the file tree. Close a `.drawio` tab opened before the
  update and open the file again.
- Regression test: the registered pattern must stay longer than the generic
  `dsh-resource://file/**` file claim.

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
