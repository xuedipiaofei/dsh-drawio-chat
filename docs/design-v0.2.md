# dsh-drawio-chat v0.2 design — chat-first draw.io, no canvas

Status: planned (this file describes the approved direction; only the v0.1
creation + inline preview + SVG export is implemented today).

## 1. Why this shape

Market check (2026-11): `dsh-drawai` leads the category with a right-side
editable canvas + `diagram_read` / `diagram_apply` + native `.drawio` files
(6.4k downloads/month, 15 releases). `dsh-drawio` (1.4k) and
`@next-ai-drawio/dsh` (0.9k) trail it. A thin "generate and look at it" card
does not earn a download: the working loop is **read the current diagram →
change it → see the change → keep the native file**.

Our surface is different: there is no canvas. The diagram lives in the chat
transcript and in the workspace `.drawio` file; the model does the editing
through tools, and the card always shows the resulting file.

Positioning: **"改图不用开画布"** — read, edit and preview draw.io diagrams in
the conversation; the right-side editor stays optional (open in draw.io).

## 2. Tools (host half)

All tools write/read the same native `.drawio` file; no parallel store.

| Tool | Purpose | Input | Output |
|---|---|---|---|
| `drawio_create` | create a new diagram file (rename of current `drawio_diagram`) | `title?`, `xml` | `path`, `revision`, `bytes` |
| `drawio_read` | inspect an existing diagram as structure, not raw XML | `path?` (defaults to the latest file created in this session) | `path`, `revision`, `pages[]`, `nodes[]`, `edges[]`, `counts` |
| `drawio_apply` | change a diagram with semantic ops, atomically | `path`, `expectRevision?`, `ops[]` | `path`, `revision`, `changed`, `counts` |
| `drawio_undo` | revert the last `drawio_apply` for a file | `path?` | `path`, `revision`, `restored` |
| `drawio_reference` | draw.io XML/reference for the model | `format` | markdown (current MCP-backed implementation) |

`drawio_apply` op set for v0.2 (batch, all-or-nothing):

- `addNode { id?, label, x, y, w?, h?, style?, parent? }`
- `addEdge { id?, source, target, label?, style?, parent? }`
- `setLabel { ids, label }`
- `setStyle { ids, patch }` (style key/value patch, e.g. `fillColor=#dae8fc`)
- `move { ids, dx, dy }` or `{ ids, x, y }`
- `remove { ids }`
- `order { id, where: 'front' | 'back' | 'forward' | 'backward' }`

Every op accepts `ids` batches where it makes sense. Ops are validated before
any write; a failure leaves the file untouched.

### Revision + undo

- `revision` = SHA-1 of the file bytes (stable across restarts).
- `expectRevision` (optional) makes an edit conditional; a mismatch returns the
  current revision so the model can re-read instead of clobbering.
- The host keeps the last 8 snapshots per file, in memory and keyed by path;
  `drawio_undo` restores the previous snapshot atomically. Snapshots are a
  convenience, not the durability story — the file plus git is.

### File model

- Read/write raw `<mxGraphModel>` and uncompressed `<mxfile><diagram>…</diagram></mxfile>`.
- Compressed `<mxfile>` diagrams are decompressed on read and written back in the
  same representation.
- Cells the op set does not understand are kept verbatim in the tree (their
  attributes and children survive; byte-exact formatting is not promised).
- Path policy: only files under the session cwd (workspace) are readable/writable;
  the tool refuses absolute paths outside it and `.drawio` is the only extension.
- No auto-layout in v0.2: the model supplies coordinates. A `dagre` layout pass is
  a possible v0.3 addition, not a dependency to take now.

## 3. Client half

- Existing card for `drawio_create` keeps rendering the created XML.
- New: cards for `drawio_read` / `drawio_apply` show the file the tool touched and
  render its current content inline. The card reads the workspace file through the
  official `@deepseek-ai/dsh-api-workspace-files` client API (added to
  `dsh.client.inject`), so the model never needs to echo XML back through the
  session log.
- Export: SVG stays; add PNG (2×) by rasterizing the exported SVG in the page via
  an offscreen canvas — no host image dependency.
- Security: viewer still renders in a sandboxed `srcdoc` iframe (`allow-scripts`,
  no `allow-same-origin`); SVG export is sanitized before download.

## 4. Deliberately out of scope

- Right-side editable canvas / layers / alignment guides (that is `dsh-drawai`).
- Selection awareness (no canvas selection exists).
- Image tracing, video recreation, SVG icon nodes (out of category for a chat card).
- Real-time collaboration, cloud storage, draw.io accounts.

## 5. Milestones and acceptance

1. **M1** — rename + repo/package cleanup (done: `dsh-drawio-chat`).
2. **M2** — `src/model/` (parse/serialize/revision/undo) + unit tests; no tools yet.
3. **M3** — `drawio_read` / `drawio_apply` / `drawio_undo` tools + host tests
   (atomicity, revision conflict, path policy, unknown-cell preservation).
4. **M4** — client cards for read/apply (workspace-file read + inline render),
   PNG export, locale parity, README/market copy update, typecheck/test/build,
   headless render + export verification.

Acceptance: a fresh workspace where the user asks "把刚才那张图的 Login 改成 登录"
produces a `drawio_apply` call on the existing `.drawio`, the card shows the new
diagram, and `drawio_undo` restores the previous revision.
