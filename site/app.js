/**
 * draw.io 场景模板库 — static gallery logic.
 *
 * Zero dependencies, plain ES2019+ browser JavaScript. Loads `./catalog.json`
 * (produced by `scripts/build-site.mjs` from `templates/`), renders one card
 * per template, then filters client-side by keyword + category.
 *
 * Diagram rendering mirrors `src/client/contract.ts` from the dsh-drawio-chat
 * plugin: draw.io's official viewer script runs inside a sandboxed `srcdoc`
 * iframe (`allow-scripts allow-popups`, no `allow-same-origin`), so the template
 * XML owns an opaque origin and never touches this page. The iframe is only
 * created once the card scrolls near the viewport.
 *
 * The editor payload is the public `#R` format:
 * `encodeURIComponent(base64(deflateRaw(encodeURIComponent(xml))))`; browsers
 * without `CompressionStream` fall back to `#R` + `encodeURIComponent(xml)`.
 */

'use strict'

/** Public draw.io viewer host (script + stencils, no account required). */
const VIEWER_ORIGIN = 'https://viewer.diagrams.net'

/** Public draw.io editor (no account required to view). */
const EDITOR_ORIGIN = 'https://app.diagrams.net'

/** Catalog is copied next to index.html by the build script. */
const CATALOG_URL = './catalog.json'

/** Entry `file` shape: `templates/<name>.drawio` (prefix optional for raw catalogs). */
const TEMPLATE_FILE_PATTERN = /^(?:templates\/)?[A-Za-z0-9][A-Za-z0-9._-]*\.drawio$/u

/** Lazily hydrate cards this far outside the viewport (CSS px). */
const PRELOAD_MARGIN = 320

/**
 * How many draw.io viewer iframes may load at the same time. Each iframe pulls
 * the ~5 MB viewer-static script, so an unbounded burst keeps the first screen
 * blank for a long time; a small queue makes the first cards render sooner.
 */
const MAX_ACTIVE_PREVIEWS = 2

/** Trusted, static inline icon markup. No catalog data is ever injected here. */
const ICONS = {
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 5H19v5.5" /><path d="M19 5l-8.5 8.5" /><path d="M18 14.5V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5" /></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" /><path d="M5 20h14" /></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 5.5H6.5A1.5 1.5 0 0 0 5 7v8.5" /></svg>',
}

/** Cached DOM references. */
const dom = {
  search: document.getElementById('template-search'),
  clear: document.getElementById('search-clear'),
  chips: document.getElementById('category-chips'),
  matchCount: document.getElementById('match-count'),
  gallery: document.getElementById('gallery'),
  empty: document.getElementById('empty-state'),
  reset: document.getElementById('reset-filters'),
  errorBanner: document.getElementById('error-banner'),
  errorDetail: document.getElementById('error-detail'),
  toast: document.getElementById('toast'),
}

/** Page state. */
const state = {
  /** Parsed catalog, or null while loading / after a load error. */
  catalog: null,
  /** Rendered cards, in catalog order. */
  items: [],
  /** Normalized (single-spaced, trimmed) search query. */
  query: '',
  /** Selected category id, or '' for "全部". */
  category: '',
  /** Category lookup by id. */
  categories: new Map(),
}

/** IntersectionObserver that lazily hydrates previews, or null when unsupported. */
let previewObserver = null

/** Timer for the toast message. */
let toastTimer = 0

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

/**
 * Create an element with an optional class name and text.
 * @param {string} tag - tag name.
 * @param {string} [className] - class attribute.
 * @param {string} [text] - text content (never HTML).
 * @returns {HTMLElement} the element.
 */
function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * Build an icon span from the trusted static markup above.
 * @param {'open'|'download'|'copy'} name - icon name.
 * @returns {HTMLSpanElement} the wrapper span.
 */
function icon(name) {
  const span = el('span', 'btn-icon')
  span.innerHTML = ICONS[name]
  return span
}

/**
 * Reduce a user-supplied query to a stable single-line form.
 * @param {string} value - raw input value.
 * @returns {string} normalized query.
 */
function normalizeQuery(value) {
  return String(value).replace(/\s+/gu, ' ').trim()
}

/**
 * Human-readable error text.
 * @param {unknown} error - thrown value.
 * @returns {string} message.
 */
function describeError(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Show a transient status message.
 * @param {string} message - text to show.
 * @param {'info'|'error'} [kind] - visual style.
 */
function showToast(message, kind = 'info') {
  dom.toast.textContent = message
  dom.toast.classList.toggle('is-error', kind === 'error')
  dom.toast.classList.add('is-visible')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove('is-visible')
  }, 2600)
}

// ---------------------------------------------------------------------------
// draw.io integration (kept in sync with src/client/contract.ts)
// ---------------------------------------------------------------------------

/**
 * Encode bytes as base64 without blowing the call stack on large payloads.
 * @param {Uint8Array} bytes - raw bytes.
 * @returns {string} base64 text.
 */
function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return window.btoa(binary)
}

/**
 * Compress bytes with raw DEFLATE.
 *
 * The readable side is drained concurrently with the write: Chrome's byte-stream
 * backpressure means awaiting `writer.write()` first would leave both promises
 * pending forever on larger payloads.
 * @param {Uint8Array} bytes - input bytes.
 * @returns {Promise<Uint8Array>} compressed bytes.
 */
async function deflateRaw(bytes) {
  const stream = new window.CompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  const reader = stream.readable.getReader()
  const chunks = []
  let total = 0
  // Starts reading synchronously, so the transform always has downstream demand.
  const drained = (async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.length
    }
  })()
  await writer.write(bytes)
  await writer.close()
  await drained
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.length
  }
  return joined
}

/**
 * Build the "open in draw.io" URL for one diagram.
 * @param {string} xml - draw.io XML.
 * @returns {Promise<string>} absolute app.diagrams.net URL.
 */
async function editorUrl(xml) {
  const prepared = encodeURIComponent(xml)
  const compression = window.CompressionStream
  if (typeof compression !== 'function') return `${EDITOR_ORIGIN}/?pv=0&grid=0#R${prepared}`
  try {
    const compressed = await deflateRaw(new TextEncoder().encode(prepared))
    return `${EDITOR_ORIGIN}/?pv=0&grid=0#R${encodeURIComponent(bytesToBase64(compressed))}`
  } catch (error) {
    // Compression is an optimisation: an uncompressed #R payload still opens.
    console.warn('[template-gallery] deflate-raw unavailable, using an uncompressed payload:', error)
    return `${EDITOR_ORIGIN}/?pv=0&grid=0#R${prepared}`
  }
}

/**
 * Build the sandboxed viewer document rendered inside a card preview.
 *
 * The XML is handed to the viewer through `data-mxgraph` instead of an HTML
 * attribute so `<` inside the model can never terminate the inline script.
 * @param {string} xml - draw.io XML.
 * @returns {string} self-contained HTML document for an iframe srcdoc.
 */
function buildViewerHtml(xml) {
  const xmlLiteral = JSON.stringify(xml).replace(/</gu, '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#ffffff;overflow:hidden}
.mxgraph{height:100%;width:100%;max-width:100%}
</style></head><body>
<div class="mxgraph" id="drawio-graph"></div>
<script>
window.mxBasePath='${VIEWER_ORIGIN}/';
var config={xml:${xmlLiteral},highlight:'#2563EB',nav:false,resize:true,toolbar:''};
document.getElementById('drawio-graph').setAttribute('data-mxgraph', JSON.stringify(config));
</script>
<script src="${VIEWER_ORIGIN}/js/viewer-static.min.js"></script>
</body></html>`
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/**
 * Fetch and minimally validate `./catalog.json`.
 * @returns {Promise<object>} parsed catalog.
 */
async function loadCatalog() {
  let response
  try {
    response = await fetch(CATALOG_URL, { cache: 'no-cache' })
  } catch (error) {
    throw new Error(`无法读取 catalog.json（${describeError(error)}）`)
  }
  if (!response.ok) throw new Error(`catalog.json 返回 HTTP ${response.status}`)
  let catalog
  try {
    catalog = await response.json()
  } catch (error) {
    throw new Error(`catalog.json 不是合法 JSON（${describeError(error)}）`)
  }
  if (catalog === null || typeof catalog !== 'object') throw new Error('catalog.json 顶层不是对象')
  if (!Array.isArray(catalog.categories)) throw new Error('catalog.json 缺少 categories 数组')
  if (!Array.isArray(catalog.templates)) throw new Error('catalog.json 缺少 templates 数组')
  catalog.categories.forEach((category, index) => {
    if (!category || typeof category.id !== 'string' || !category.title || typeof category.title.zh !== 'string') {
      throw new Error(`catalog.json 的 categories[${index}] 缺少 id / title.zh`)
    }
  })
  catalog.templates.forEach((entry, index) => {
    if (!entry || typeof entry.id !== 'string') throw new Error(`catalog.json 的 templates[${index}] 缺少 id`)
    if (typeof entry.file !== 'string' || !TEMPLATE_FILE_PATTERN.test(entry.file)) {
      throw new Error(`模板 "${entry.id}" 的 file 字段不合法`)
    }
    if (!entry.title || typeof entry.title.zh !== 'string') throw new Error(`模板 "${entry.id}" 缺少 title.zh`)
    if (!entry.description || typeof entry.description.zh !== 'string') throw new Error(`模板 "${entry.id}" 缺少 description.zh`)
    if (!Array.isArray(entry.tags)) throw new Error(`模板 "${entry.id}" 缺少 tags 数组`)
    const category = catalog.categories.find(candidate => candidate.id === entry.category)
    if (!category) throw new Error(`模板 "${entry.id}" 引用了不存在的分类 "${entry.category}"`)
  })
  return catalog
}

/**
 * Lower-cased haystack used by the keyword filter: id, category (id + zh/en
 * titles), bilingual titles/descriptions and tags. Mirrors the plugin's
 * `searchTemplates` semantics but also matches category titles.
 * @param {object} entry - catalog template entry.
 * @returns {string} lower-cased searchable text.
 */
function entryHaystack(entry) {
  const category = state.categories.get(entry.category)
  const parts = [
    entry.id,
    entry.category,
    category ? category.title.zh : '',
    category ? category.title.en : '',
    entry.title.zh,
    entry.title.en,
    entry.description.zh,
    entry.description.en,
    ...entry.tags,
  ]
  return parts.join(' ').toLowerCase()
}

/**
 * Relative URL of a catalog entry's `.drawio` file.
 *
 * The built catalog stores `templates/<name>.drawio` so the deployed
 * `catalog.json` also works as a DSH remote template catalog (the plugin
 * resolves `file` against the catalog URL). A raw, unprefixed catalog is still
 * served correctly by prepending `templates/`.
 * @param {string} file - catalog `file` value.
 * @returns {string} site-relative URL.
 */
function templateUrl(file) {
  return `./${file.startsWith('templates/') ? file : `templates/${file}`}`
}

/**
 * File name to use for downloads (catalog `file` may carry the `templates/` prefix).
 * @param {string} file - catalog `file` value.
 * @returns {string} base file name.
 */
function downloadFileName(file) {
  const parts = file.split('/')
  return parts[parts.length - 1]
}

/**
 * Fetch one template's XML (cached per card).
 * @param {object} item - rendered card state.
 * @returns {Promise<string>} template XML.
 */
function loadTemplateXml(item) {
  if (item.xmlPromise === null) {
    item.xmlPromise = fetch(templateUrl(item.entry.file), { cache: 'force-cache' })
      .then((response) => {
        if (!response.ok) throw new Error(`模板文件 ${item.entry.file} 返回 HTTP ${response.status}`)
        return response.text()
      })
      .then((text) => {
        if (text.trim() === '') throw new Error(`模板文件 ${item.entry.file} 为空`)
        return text
      })
  }
  return item.xmlPromise
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render one category chip ("全部" first).
 * @param {string} id - category id, or '' for all.
 * @param {string} label - visible label.
 * @param {string} [hint] - English hint used as the tooltip.
 * @returns {HTMLButtonElement} chip button.
 */
function createChip(id, label, hint) {
  const chip = el('button', 'chip')
  chip.type = 'button'
  chip.dataset.category = id
  chip.textContent = label
  chip.title = hint ? `${label} · ${hint}` : '显示全部模板'
  chip.setAttribute('aria-pressed', 'false')
  chip.addEventListener('click', () => {
    state.category = id
    applyFilters()
  })
  return chip
}

/** Render the chip row from the loaded catalog. */
function renderChips() {
  const fragment = document.createDocumentFragment()
  fragment.append(createChip('', '全部'))
  for (const category of state.catalog.categories) {
    fragment.append(createChip(category.id, category.title.zh, category.title.en))
  }
  dom.chips.replaceChildren(fragment)
}

/**
 * Create the lazy preview area for one card.
 * @param {object} item - rendered card state (mutated).
 * @returns {HTMLElement} preview container.
 */
function createPreview(item) {
  const preview = el('div', 'card-preview')
  const placeholder = el('div', 'preview-placeholder')
  const spinner = el('span', 'spinner')
  spinner.setAttribute('aria-hidden', 'true')
  const label = el('span', 'preview-label', '预览加载中…')
  placeholder.append(spinner, label)
  preview.append(placeholder)
  item.previewEl = preview
  item.placeholder = placeholder
  return preview
}

/**
 * Create one template card.
 * @param {object} entry - catalog template entry.
 * @returns {object} rendered card state.
 */
function createCard(entry) {
  const item = {
    entry,
    element: el('article', 'card'),
    previewEl: null,
    placeholder: null,
    /** 'idle' | 'queued' | 'loading' | 'loaded' | 'error' */
    previewState: 'idle',
    /** Whether this card currently occupies one of the MAX_ACTIVE_PREVIEWS slots. */
    slotHeld: false,
    xmlPromise: null,
    editorHref: '',
    openLink: null,
  }
  item.element.dataset.templateId = entry.id
  item.element.dataset.category = entry.category

  const preview = createPreview(item)

  const body = el('div', 'card-body')

  const kicker = el('div', 'card-kicker')
  const category = state.categories.get(entry.category)
  const badge = el('span', 'category-badge', category ? category.title.zh : entry.category)
  if (category) badge.title = `${category.title.zh} · ${category.title.en}`
  const idLabel = el('span', 'card-id', entry.id)
  idLabel.title = `模板 ID：${entry.id}`
  kicker.append(badge, idLabel)

  const title = el('h2', 'card-title', entry.title.zh)
  const subtitle = el('p', 'card-subtitle', entry.title.en)
  subtitle.lang = 'en'

  const description = el('p', 'card-desc', entry.description.zh)
  description.title = entry.description.zh

  const tags = el('ul', 'tag-list')
  tags.setAttribute('aria-label', '标签')
  for (const tag of entry.tags) tags.append(el('li', 'tag', tag))

  const actions = el('div', 'card-actions')

  // 1) Open in draw.io — becomes a plain anchor with a real href once the XML
  //    has been loaded; before that a click opens a placeholder tab and fills it
  //    in, which keeps popup blockers happy.
  const open = el('a', 'btn btn-primary')
  open.href = '#'
  open.target = '_blank'
  open.rel = 'noopener noreferrer'
  open.dataset.action = 'open-in-drawio'
  open.setAttribute('aria-disabled', 'true')
  const openTitle = `在 draw.io 中打开「${entry.title.zh}」`
  open.title = openTitle
  open.setAttribute('aria-label', openTitle)
  open.append(icon('open'), el('span', 'btn-label', '在 draw.io 打开'))
  open.addEventListener('click', (event) => {
    if (item.editorHref) return
    event.preventDefault()
    void openInEditor(item)
  })
  item.openLink = open

  // 2) Download the .drawio source.
  const download = el('button', 'btn btn-secondary')
  download.type = 'button'
  download.dataset.action = 'download-drawio'
  download.title = `下载「${entry.title.zh}」的 .drawio 源文件`
  download.setAttribute('aria-label', download.title)
  download.append(icon('download'), el('span', 'btn-label', '下载 .drawio'))
  download.addEventListener('click', () => {
    void downloadTemplate(item, download)
  })

  // 3) Copy a ready-to-paste prompt for the chat model.
  const copy = el('button', 'btn btn-ghost')
  copy.type = 'button'
  copy.dataset.action = 'copy-prompt'
  copy.title = '复制一句可直接发给模型的提示词'
  copy.setAttribute('aria-label', `复制「${entry.title.zh}」的提示词`)
  copy.append(icon('copy'), el('span', 'btn-label', '复制提示词'))
  copy.addEventListener('click', () => {
    void copyPrompt(item, copy)
  })

  actions.append(open, download, copy)
  body.append(kicker, title, subtitle, description, tags, actions)

  item.element.append(preview, body)
  return item
}

/** Render the full card grid (unfiltered; filtering only toggles visibility). */
function renderGallery() {
  const fragment = document.createDocumentFragment()
  for (const entry of state.catalog.templates) {
    const item = createCard(entry)
    item._haystack = entryHaystack(entry)
    state.items.push(item)
    fragment.append(item.element)
  }
  dom.gallery.replaceChildren(fragment)

  for (const item of state.items) {
    if (previewObserver) {
      previewObserver.observe(item.previewEl)
    } else {
      // No IntersectionObserver: fall back to an immediate viewport check.
      maybeHydrate(item)
    }
  }
}

// ---------------------------------------------------------------------------
// Preview hydration
// ---------------------------------------------------------------------------

/** Cards waiting for a free viewer slot (in discovery order). */
const previewQueue = []

/** Items are rendered lazily but at most MAX_ACTIVE_PREVIEWS load their viewer. */
const previewHydrator = {
  active: 0,
  /** Extra time before a stuck viewer releases its queue slot. */
  timeoutMs: 25000,
}

/**
 * Queue a card for preview hydration. Never hydrates the same card twice and
 * keeps cards that are filtered out of the queue.
 * @param {object} item - rendered card state.
 */
function schedulePreview(item) {
  if (item.previewState !== 'idle') return
  item.previewState = 'queued'
  previewQueue.push(item)
  pumpPreviewQueue()
}

/** Start queued previews while viewer slots are free. */
function pumpPreviewQueue() {
  while (previewHydrator.active < MAX_ACTIVE_PREVIEWS && previewQueue.length > 0) {
    const item = previewQueue.shift()
    if (item.previewState !== 'queued') continue
    if (item.element.hidden) {
      // Filtered out while waiting: leave it for when it becomes visible again.
      item.previewState = 'idle'
      continue
    }
    previewHydrator.active += 1
    hydratePreview(item)
  }
}

/**
 * Release the viewer slot held by one card (idempotent).
 * @param {object} item - rendered card state.
 */
function releasePreviewSlot(item) {
  if (item.slotHeld !== true) return
  item.slotHeld = false
  previewHydrator.active = Math.max(0, previewHydrator.active - 1)
  pumpPreviewQueue()
}

/**
 * Attach the draw.io viewer iframe once; safe to call repeatedly. The caller
 * (pumpPreviewQueue) owns the slot, which is released when the viewer iframe
 * has loaded or failed.
 * @param {object} item - rendered card state.
 */
function hydratePreview(item) {
  item.previewState = 'loading'
  item.slotHeld = true
  if (previewObserver) previewObserver.unobserve(item.previewEl)
  const slotTimer = window.setTimeout(() => releasePreviewSlot(item), previewHydrator.timeoutMs)

  loadTemplateXml(item)
    .then((xml) => {
      item.previewState = 'loaded'
      const iframe = document.createElement('iframe')
      iframe.className = 'preview-frame'
      iframe.setAttribute('sandbox', 'allow-scripts allow-popups')
      iframe.setAttribute('title', `${item.entry.title.zh}（${item.entry.title.en}）预览`)
      iframe.setAttribute('referrerpolicy', 'no-referrer')
      iframe.addEventListener('load', () => {
        item.placeholder.hidden = true
        window.clearTimeout(slotTimer)
        releasePreviewSlot(item)
      })
      iframe.srcdoc = buildViewerHtml(xml)
      item.previewEl.append(iframe)

      editorUrl(xml)
        .then((href) => {
          item.editorHref = href
          item.openLink.href = href
          item.openLink.removeAttribute('aria-disabled')
        })
        .catch((error) => {
          console.warn('[template-gallery] could not pre-build the editor URL:', error)
        })
    })
    .catch((error) => {
      window.clearTimeout(slotTimer)
      item.previewState = 'error'
      item.previewEl.classList.add('has-error')
      item.placeholder.lastChild.textContent = '预览加载失败'
      console.warn(`[template-gallery] preview failed for ${item.entry.id}:`, error)
      releasePreviewSlot(item)
    })
}

/**
 * Hydrate a card if its preview is inside the viewport (plus margin).
 * @param {object} item - rendered card state.
 */
function maybeHydrate(item) {
  if (item.previewState !== 'idle' || item.element.hidden) return
  const rect = item.previewEl.getBoundingClientRect()
  if (rect.top < window.innerHeight + PRELOAD_MARGIN && rect.bottom > -PRELOAD_MARGIN) schedulePreview(item)
}

/** Hydrate every not-yet-loaded card in or near the viewport. */
function hydrateVisibleCards() {
  for (const item of state.items) maybeHydrate(item)
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Does one card match the current keyword + category filters?
 * The query is split on whitespace and every token must appear in the card's
 * searchable text — Chinese substrings are matched by plain `includes`.
 * @param {object} item - rendered card state.
 * @returns {boolean} true when the card should be visible.
 */
function matchesFilters(item) {
  if (state.category !== '' && item.entry.category !== state.category) return false
  if (state.query === '') return true
  const tokens = state.query.toLowerCase().split(/\s+/u).filter(token => token !== '')
  return tokens.every(token => item._haystack.includes(token))
}

/** Recompute visibility, count text, chip state, URL and lazy previews. */
function applyFilters() {
  const filtered = state.query !== '' || state.category !== ''
  let visible = 0

  for (const item of state.items) {
    const show = matchesFilters(item)
    item.element.hidden = !show
    if (show) visible += 1
  }

  dom.clear.hidden = state.query === ''
  dom.empty.hidden = visible !== 0
  dom.matchCount.textContent = filtered
    ? `匹配 ${visible} / ${state.items.length} 个模板`
    : `共 ${state.items.length} 个模板`

  for (const chip of dom.chips.querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.category === state.category))
  }

  syncUrl()
  hydrateVisibleCards()
}

/** Mirror the current filters into `?q=` / `?category=` for shareable links. */
function syncUrl() {
  try {
    const params = new URLSearchParams()
    if (state.query !== '') params.set('q', state.query)
    if (state.category !== '') params.set('category', state.category)
    const search = params.toString()
    const next = `${window.location.pathname}${search === '' ? '' : `?${search}`}`
    window.history.replaceState(null, '', next)
  } catch {
    // file:// URLs may reject history updates; filtering still works.
  }
}

// ---------------------------------------------------------------------------
// Card actions
// ---------------------------------------------------------------------------

/**
 * Open a template in draw.io (new tab).
 *
 * When the payload is not ready yet, a blank tab is opened synchronously (so
 * the popup is allowed), then navigated once the URL is available.
 * @param {object} item - rendered card state.
 */
async function openInEditor(item) {
  let placeholderWindow = null
  try {
    placeholderWindow = window.open('', '_blank')
    const xml = await loadTemplateXml(item)
    const href = item.editorHref || (await editorUrl(xml))
    item.editorHref = href
    item.openLink.href = href
    item.openLink.removeAttribute('aria-disabled')
    if (placeholderWindow) {
      placeholderWindow.opener = null
      placeholderWindow.location.replace(href)
    } else {
      window.open(href, '_blank', 'noopener')
    }
  } catch (error) {
    if (placeholderWindow) placeholderWindow.close()
    showToast(`无法在 draw.io 中打开：${describeError(error)}`, 'error')
  }
}

/**
 * Download a template's `.drawio` source as a Blob.
 * @param {object} item - rendered card state.
 * @param {HTMLButtonElement} button - clicked button (for coalescing clicks).
 */
async function downloadTemplate(item, button) {
  if (button.disabled) return
  button.disabled = true
  try {
    const xml = await loadTemplateXml(item)
    const fileName = downloadFileName(item.entry.file)
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = fileName
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 4000)
    showToast(`已开始下载 ${fileName}`)
  } catch (error) {
    showToast(`下载失败：${describeError(error)}`, 'error')
  } finally {
    button.disabled = false
  }
}

/**
 * Copy text to the clipboard, falling back to a hidden textarea.
 * @param {string} text - text to copy.
 */
async function copyText(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Permission denied / insecure context: fall through to the textarea.
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('剪贴板不可用')
}

/**
 * Copy a ready-to-paste prompt for the zh title.
 * @param {object} item - rendered card state.
 * @param {HTMLButtonElement} button - clicked button.
 */
async function copyPrompt(item, button) {
  const prompt = `用「${item.entry.title.zh}」模板画一张图，然后按我的需求修改。`
  try {
    await copyText(prompt)
    flashCopied(button)
    showToast('提示词已复制到剪贴板')
  } catch {
    showToast(`复制失败，请手动复制：${prompt}`, 'error')
  }
}

/**
 * Temporarily swap a button label to "已复制".
 * @param {HTMLButtonElement} button - copy button.
 */
function flashCopied(button) {
  const label = button.querySelector('.btn-label')
  if (!label) return
  window.clearTimeout(button._copiedTimer)
  label.textContent = '已复制'
  button.classList.add('is-copied')
  button._copiedTimer = window.setTimeout(() => {
    label.textContent = '复制提示词'
    button.classList.remove('is-copied')
  }, 1800)
}

// ---------------------------------------------------------------------------
// Wire-up
// ---------------------------------------------------------------------------

/** Read `?q=` / `?category=` from the URL (shareable filtered links). */
function readUrlState() {
  const params = new URLSearchParams(window.location.search)
  state.query = normalizeQuery(params.get('q') ?? '')
  state.category = params.get('category') ?? ''
  dom.search.value = state.query
}

/** Attach toolbar and keyboard listeners. */
function bindEvents() {
  dom.search.addEventListener('input', () => {
    state.query = normalizeQuery(dom.search.value)
    applyFilters()
  })

  dom.search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dom.search.value !== '') {
      event.preventDefault()
      setQuery('')
    }
  })

  dom.clear.addEventListener('click', () => {
    setQuery('')
    dom.search.focus()
  })

  dom.reset.addEventListener('click', () => {
    state.category = ''
    setQuery('')
  })

  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
    const target = document.activeElement
    if (target === dom.search) return
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
    if (target instanceof HTMLElement && target.isContentEditable) return
    event.preventDefault()
    dom.search.focus()
  })

  // Scroll fallback for browsers without IntersectionObserver.
  if (!previewObserver) {
    let scheduled = false
    window.addEventListener('scroll', () => {
      if (scheduled) return
      scheduled = true
      window.requestAnimationFrame(() => {
        scheduled = false
        hydrateVisibleCards()
      })
    }, { passive: true })
  }
}

/**
 * Reset the keyword filter and re-apply.
 * @param {string} value - new query.
 */
function setQuery(value) {
  dom.search.value = value
  state.query = normalizeQuery(value)
  applyFilters()
}

/** Browser entry point. */
async function init() {
  readUrlState()

  if ('IntersectionObserver' in window) {
    previewObserver = new IntersectionObserver((records) => {
      for (const record of records) {
        if (!record.isIntersecting) continue
        const item = state.items.find(candidate => candidate.previewEl === record.target)
        if (item) schedulePreview(item)
      }
    }, { rootMargin: `${PRELOAD_MARGIN}px 0px` })
  }

  bindEvents()

  try {
    state.catalog = await loadCatalog()
    state.categories = new Map(state.catalog.categories.map(category => [category.id, category]))
    if (state.category !== '' && !state.categories.has(state.category)) state.category = ''
    renderChips()
    renderGallery()
    applyFilters()
  } catch (error) {
    console.error('[template-gallery] catalog load failed:', error)
    dom.errorBanner.hidden = false
    dom.errorDetail.textContent = `${describeError(error)} 请刷新页面重试；若直接双击打开了 index.html，请改用本地静态服务器访问。`
    dom.matchCount.textContent = '加载失败'
    dom.empty.hidden = true
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void init()
  })
} else {
  void init()
}
