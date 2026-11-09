/**
 * Built-in scenario template catalog.
 *
 * The templates ship inside the plugin package (`templates/`) and are copied
 * into the session workspace on demand by the `drawio_template` tool. The same
 * manifest is the seed for the future public template site: `id`, bilingual
 * title/description, category, tags, license and a relative `file` — nothing
 * plugin-specific.
 *
 * All functions are pure reads except the catalog load; nothing here writes.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DiagramError } from './diagram.ts'

/** Bilingual copy of a catalog string. */
export interface TemplateText {
  zh: string
  en: string
}

/** One template category. */
export interface TemplateCategory {
  id: string
  title: TemplateText
}

/** Which catalog an entry came from. */
export type TemplateSource = 'builtin' | 'remote'

/** One template entry. */
export interface TemplateEntry {
  id: string
  /**
   * For built-in entries: the file name inside `templates/` (never a path
   * outside it). For remote entries: the absolute HTTPS URL of the `.drawio`
   * file, already resolved against the catalog URL.
   */
  file: string
  category: string
  title: TemplateText
  description: TemplateText
  tags: string[]
  /** Where the entry was read from (defaults to the bundled catalog). */
  source?: TemplateSource
  /** The remote catalog URL this entry came from (remote entries only). */
  catalogUrl?: string
}

/** The whole catalog. */
export interface TemplateCatalog {
  version: number
  license?: string
  categories: TemplateCategory[]
  templates: TemplateEntry[]
}

/** Result of a filtered catalog search. */
export interface TemplateSearch {
  entries: TemplateEntry[]
  query?: string
  category?: string
}

/** What the model sees in the tool result: a compact, flat entry view. */
export interface TemplateListEntry {
  id: string
  title: string
  titleEn: string
  category: string
  tags: string[]
  description: string
  source: TemplateSource
}

/** A validated remote catalog and the URL it was read from. */
export interface RemoteCatalog {
  catalog: TemplateCatalog
  catalogUrl: string
}

const ID_PATTERN = /^[a-z0-9]+(?:[-/][a-z0-9]+)*$/u
const FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.drawio$/u
const CATALOG_DIR = 'templates'
const CATALOG_FILE = 'catalog.json'

/** Directory of the module that owns this file (works in `src/` and `lib/`). */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * Find the plugin package root from the module location.
 *
 * At runtime the node half is bundled into `lib/index.js`, so the module
 * directory is `<root>/lib`; under vitest it is `<root>/src/model`. Walking up
 * until the catalog is found covers both, and the dev workspace itself.
 * @returns absolute package root.
 */
function packageRoot(): string {
  let dir = MODULE_DIR
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, CATALOG_DIR, CATALOG_FILE)) && existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new DiagramError(`could not locate the bundled template catalog (${CATALOG_DIR}/${CATALOG_FILE}) from ${MODULE_DIR}`)
}

/** Absolute path of the bundled `templates/` directory. */
export function templatesDir(): string {
  return join(packageRoot(), CATALOG_DIR)
}

/** Absolute path of the bundled `catalog.json`. */
export function catalogPath(): string {
  return join(templatesDir(), CATALOG_FILE)
}

/** Read a string field of a bilingual object. */
function textOf(value: unknown, what: string): TemplateText {
  if (value === null || typeof value !== 'object') throw new DiagramError(`template catalog: ${what} must be an object with zh/en strings`)
  const record = value as Record<string, unknown>
  const zh = record.zh
  const en = record.en
  if (typeof zh !== 'string' || zh.trim() === '') throw new DiagramError(`template catalog: ${what}.zh must be a non-empty string`)
  if (typeof en !== 'string' || en.trim() === '') throw new DiagramError(`template catalog: ${what}.en must be a non-empty string`)
  return { zh, en }
}

/**
 * Validate one parsed catalog document.
 * @param raw - parsed JSON.
 * @param options - `remote` accepts absolute HTTPS `file` URLs and tags every
 *   entry with its source; the bundled catalog keeps the file-name rule.
 * @returns the typed catalog.
 */
export function validateCatalog(raw: unknown, options: { remote?: boolean; catalogUrl?: string } = {}): TemplateCatalog {
  if (raw === null || typeof raw !== 'object') throw new DiagramError('template catalog must be a JSON object')
  const record = raw as Record<string, unknown>
  if (record.version !== 1) throw new DiagramError('template catalog: unsupported version (expected 1)')
  if (!Array.isArray(record.categories) || record.categories.length === 0) throw new DiagramError('template catalog: categories must be a non-empty array')
  if (!Array.isArray(record.templates) || record.templates.length === 0) throw new DiagramError('template catalog: templates must be a non-empty array')
  const categories: TemplateCategory[] = []
  const categoryIds = new Set<string>()
  for (const value of record.categories) {
    if (value === null || typeof value !== 'object') throw new DiagramError('template catalog: a category must be an object')
    const category = value as Record<string, unknown>
    if (typeof category.id !== 'string' || !ID_PATTERN.test(category.id)) throw new DiagramError(`template catalog: invalid category id ${JSON.stringify(category.id)}`)
    if (categoryIds.has(category.id)) throw new DiagramError(`template catalog: duplicate category id "${category.id}"`)
    categoryIds.add(category.id)
    categories.push({ id: category.id, title: textOf(category.title, `category "${category.id}" title`) })
  }
  const templates: TemplateEntry[] = []
  const templateIds = new Set<string>()
  for (const value of record.templates) {
    if (value === null || typeof value !== 'object') throw new DiagramError('template catalog: a template must be an object')
    const template = value as Record<string, unknown>
    const id = template.id
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new DiagramError(`template catalog: invalid template id ${JSON.stringify(id)}`)
    if (templateIds.has(id)) throw new DiagramError(`template catalog: duplicate template id "${id}"`)
    templateIds.add(id)
    const file = template.file
    let resolvedFile: string
    if (options.remote === true) {
      if (typeof file !== 'string' || file.trim() === '') throw new DiagramError(`template catalog: template "${id}" needs a file URL`)
      const base = options.catalogUrl
      let resolved: URL
      try {
        resolved = new URL(file.trim(), base)
      } catch {
        throw new DiagramError(`template catalog: template "${id}" file is not a valid URL: ${file}`)
      }
      assertRemoteUrl(resolved.toString(), `template "${id}" file`)
      if (!/\.drawio$/iu.test(resolved.pathname)) throw new DiagramError(`template catalog: template "${id}" file must be a .drawio file: ${resolved.toString()}`)
      resolvedFile = resolved.toString()
    } else {
      if (typeof file !== 'string' || !FILE_PATTERN.test(file)) throw new DiagramError(`template catalog: template "${id}" has an invalid file name (expected a *.drawio name inside templates/)`)
      resolvedFile = file
    }
    const category = template.category
    if (typeof category !== 'string' || !categoryIds.has(category)) throw new DiagramError(`template catalog: template "${id}" names unknown category ${JSON.stringify(category)}`)
    const tags = template.tags
    if (!Array.isArray(tags) || tags.length === 0 || tags.some(tag => typeof tag !== 'string' || tag.trim() === '')) {
      throw new DiagramError(`template catalog: template "${id}" needs a non-empty tags array of strings`)
    }
    templates.push({
      id,
      file: resolvedFile,
      category,
      title: textOf(template.title, `template "${id}" title`),
      description: textOf(template.description, `template "${id}" description`),
      tags: tags.map(tag => (tag as string).trim()),
      source: options.remote === true ? 'remote' : 'builtin',
      ...(options.remote === true && options.catalogUrl !== undefined ? { catalogUrl: options.catalogUrl } : {}),
    })
  }
  return {
    version: 1,
    ...(typeof record.license === 'string' ? { license: record.license } : {}),
    categories,
    templates,
  }
}

/**
 * Load and validate the catalog bundled with the plugin.
 * @returns the typed catalog.
 */
export function loadCatalog(): TemplateCatalog {
  const path = catalogPath()
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    throw new DiagramError(`could not read the template catalog at ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new DiagramError(`template catalog is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return validateCatalog(parsed)
}

/**
 * Resolve a template entry to its file, refusing anything outside `templates/`.
 * @param entry - catalog entry.
 * @returns absolute template file path.
 */
export function templateFile(entry: TemplateEntry): string {
  if (/^https?:/iu.test(entry.file)) throw new DiagramError(`template "${entry.id}" is a remote entry; fetch its XML with fetchTemplateXml()`)
  const dir = templatesDir()
  const path = resolve(dir, entry.file)
  const rel = relative(dir, path)
  if (rel === '' || rel.startsWith('..') || resolve(rel) === rel) throw new DiagramError(`template "${entry.id}" escapes the templates directory`)
  if (!existsSync(path)) throw new DiagramError(`template "${entry.id}" file is missing: ${entry.file}`)
  return path
}

/** Read a built-in template's XML. */
export function readTemplateXml(entry: TemplateEntry): string {
  return readFileSync(templateFile(entry), 'utf8')
}

/** Largest catalog document accepted from a remote URL (512 KiB). */
const MAX_REMOTE_CATALOG_BYTES = 512 * 1024

/** Largest remote `.drawio` file accepted (2 MiB — the plugin's XML cap). */
const MAX_REMOTE_TEMPLATE_BYTES = 2 * 1024 * 1024

/** How long a fetched remote catalog is reused in this process (ms). */
const REMOTE_CATALOG_TTL_MS = 60_000

/** Process-local cache of remote catalogs, keyed by URL. */
const remoteCatalogCache = new Map<string, { at: number; value: Promise<RemoteCatalog> }>()

/**
 * Reject anything that is not a public HTTPS URL.
 *
 * The model supplies the catalog URL, so the fetch must never reach loopback
 * or private-network addresses of the DSH host, and must not carry credentials.
 * @param raw - candidate URL.
 * @param what - label used in the error message.
 * @returns the parsed URL.
 */
export function assertRemoteUrl(raw: string, what = 'remote URL'): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new DiagramError(`${what} is not a valid URL: ${raw}`)
  }
  if (url.protocol !== 'https:') throw new DiagramError(`${what} must use HTTPS: ${raw}`)
  if (url.username !== '' || url.password !== '') throw new DiagramError(`${what} must not carry credentials: ${raw}`)
  const host = url.hostname.toLowerCase()
  const privateHost = host === 'localhost' || host.endsWith('.local') || host === '[::1]' || host === '::1' || host === '0.0.0.0'
    || /^127\./u.test(host) || /^10\./u.test(host) || /^192\.168\./u.test(host) || /^169\.254\./u.test(host) || /^172\.(1[6-9]|2\d|3[01])\./u.test(host)
  if (privateHost) throw new DiagramError(`${what} must not point at a private or loopback address: ${raw}`)
  return url
}

/** Fetch one text resource with a timeout and a byte cap. */
async function fetchText(url: string, what: string, maxBytes: number, accept: string): Promise<string> {
  const target = assertRemoteUrl(url, what)
  let response: Response
  try {
    response = await fetch(target.toString(), {
      signal: AbortSignal.timeout(8_000),
      headers: { accept },
      redirect: 'follow',
    })
  } catch (error) {
    throw new DiagramError(`${what} could not be fetched: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) throw new DiagramError(`${what} returned HTTP ${response.status}`)
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new DiagramError(`${what} exceeds ${maxBytes} bytes`)
  return text
}

/**
 * Fetch and validate a remote catalog.
 *
 * Entries keep the bundled shape; each `file` becomes an absolute HTTPS URL
 * resolved against the catalog URL. A successful fetch is cached for a minute
 * so a list + instantiate pair costs one round-trip.
 * @param catalogUrl - public HTTPS URL of a catalog.json.
 * @returns the validated catalog and its URL.
 */
export async function fetchRemoteCatalog(catalogUrl: string): Promise<RemoteCatalog> {
  const target = assertRemoteUrl(catalogUrl, 'catalog URL').toString()
  const cached = remoteCatalogCache.get(target)
  if (cached !== undefined && Date.now() - cached.at < REMOTE_CATALOG_TTL_MS) return cached.value
  const value = (async (): Promise<RemoteCatalog> => {
    const text = await fetchText(target, 'remote catalog', MAX_REMOTE_CATALOG_BYTES, 'application/json, text/plain, */*')
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new DiagramError(`remote catalog is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
    return { catalog: validateCatalog(parsed, { remote: true, catalogUrl: target }), catalogUrl: target }
  })()
  remoteCatalogCache.set(target, { at: Date.now(), value })
  value.catch(() => { remoteCatalogCache.delete(target) })
  return value
}

/**
 * Merge catalogs (bundled first); duplicate ids keep the first entry.
 * @param catalogs - catalogs in precedence order.
 * @returns a combined catalog.
 */
export function mergeCatalogs(...catalogs: TemplateCatalog[]): TemplateCatalog {
  const categories: TemplateCategory[] = []
  const seenCategories = new Set<string>()
  const templates: TemplateEntry[] = []
  const seenIds = new Set<string>()
  for (const catalog of catalogs) {
    for (const category of catalog.categories) {
      if (seenCategories.has(category.id)) continue
      seenCategories.add(category.id)
      categories.push(category)
    }
    for (const entry of catalog.templates) {
      if (seenIds.has(entry.id)) continue
      seenIds.add(entry.id)
      templates.push(entry)
    }
  }
  return { version: 1, license: catalogs[0]?.license, categories, templates }
}

/**
 * Read a template's XML from either source.
 * @param entry - catalog entry.
 * @returns the XML string.
 */
export async function fetchTemplateXml(entry: TemplateEntry): Promise<string> {
  if (entry.source !== 'remote') return readTemplateXml(entry)
  return fetchText(entry.file, `template "${entry.id}"`, MAX_REMOTE_TEMPLATE_BYTES, 'application/xml, text/xml, text/plain, */*')
}

/** Everything a query can match against, lower-cased. */
function searchable(entry: TemplateEntry): string {
  return [entry.id, entry.category, entry.title.zh, entry.title.en, entry.description.zh, entry.description.en, ...entry.tags].join(' ').toLowerCase()
}

/**
 * Filter the catalog by free-text query and/or category.
 *
 * The query is split on whitespace and every token must appear somewhere in
 * the entry's id/category/title/description/tags — Chinese substrings included.
 * @param catalog - loaded catalog.
 * @param filters - optional query / category.
 * @returns matching entries in catalog order.
 * @throws when the category is unknown.
 */
export function searchTemplates(catalog: TemplateCatalog, filters: { query?: string; category?: string } = {}): TemplateEntry[] {
  const query = typeof filters.query === 'string' ? filters.query.trim().toLowerCase() : ''
  const category = typeof filters.category === 'string' ? filters.category.trim() : ''
  if (category !== '') {
    const known = catalog.categories.some(entry => entry.id === category)
    if (!known) throw new DiagramError(`unknown template category "${category}"; available: ${catalog.categories.map(entry => entry.id).join(', ')}`)
  }
  const tokens = query === '' ? [] : query.split(/\s+/u).filter(token => token !== '')
  return catalog.templates.filter((entry) => {
    if (category !== '' && entry.category !== category) return false
    if (tokens.length === 0) return true
    const haystack = searchable(entry)
    return tokens.every(token => haystack.includes(token))
  })
}

/** Category title in the requested language (falls back to the id). */
export function categoryTitle(catalog: TemplateCatalog, category: string, language: 'zh' | 'en' = 'zh'): string {
  return catalog.categories.find(entry => entry.id === category)?.title[language] ?? category
}

/** Flat entry view for the tool result schema. */
export function listEntry(entry: TemplateEntry): TemplateListEntry {
  return {
    id: entry.id,
    title: entry.title.zh,
    titleEn: entry.title.en,
    category: entry.category,
    tags: entry.tags,
    description: entry.description.zh,
    source: entry.source ?? 'builtin',
  }
}

/**
 * Render the model-facing text for a catalog result.
 * @param catalog - loaded catalog.
 * @param entries - already-filtered entries.
 * @param filters - the filters that produced them (for the header).
 * @returns compact markdown-ish text.
 */
export function renderCatalogText(catalog: TemplateCatalog, entries: TemplateEntry[], filters: { query?: string; category?: string } = {}): string {
  const filtered = (filters.query ?? '') !== '' || (filters.category ?? '') !== ''
  const header = filtered
    ? `匹配到 ${entries.length} 个模板${(filters.query ?? '') === '' ? '' : `（关键词：${filters.query ?? ''}）`}${(filters.category ?? '') === '' ? '' : `（分类：${filters.category ?? ''} — ${categoryTitle(catalog, filters.category ?? '')}）`}`
    : `内置模板 ${entries.length} 个`
  if (entries.length === 0) {
    return `${header}\n\n没有匹配的模板。可用分类：${catalog.categories.map(entry => `${entry.id}(${entry.title.zh})`).join('、')}；也可以不传 query 查看全部模板，或直接让模型用 drawio_create 手绘。`
  }
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1)
  const categoryLine = [...counts.entries()].map(([id, count]) => `${id}(${count})`).join(' · ')
  const lines = [header, `分类：${categoryLine}`, '']
  for (const entry of entries) {
    lines.push(`- ${entry.id}${entry.source === 'remote' ? ' [远程]' : ''}  ${entry.title.zh} / ${entry.title.en}`)
    lines.push(`  ${entry.description.zh}`)
    lines.push(`  分类 ${entry.category} · 标签：${entry.tags.join('、')}`)
  }
  lines.push('', '用法：`drawio_template({ id: "<id>" })` 把模板复制到工作区 diagrams/ 并渲染卡片；随后用 drawio_read / drawio_apply 按用户需求改文字、增删节点。可选 `path` 指定输出文件名，`title` 覆盖卡片标题。')
  return lines.join('\n')
}
