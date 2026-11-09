/**
 * Built-in scenario templates: catalog schema, file health, layout sanity and
 * the search/listing behavior the `drawio_template` tool exposes.
 */
import { describe, expect, it } from 'vitest'
import { afterEach, vi } from 'vitest'
import { readDiagramSource, summarizeDiagram, type CellSummary } from '../src/model/diagram.ts'
import {
  assertRemoteUrl,
  categoryTitle,
  fetchRemoteCatalog,
  fetchTemplateXml,
  listEntry,
  loadCatalog,
  mergeCatalogs,
  readTemplateXml,
  renderCatalogText,
  searchTemplates,
  templateFile,
  templatesDir,
  validateCatalog,
} from '../src/model/templates.ts'

const catalog = loadCatalog()

/** Shapes that legitimately sit on top of another shape. */
const OVERLAY = /(^|;)text(;|$)|swimlane|shape=image|shape=line|shape=note|dashed=1/iu

/** Whether two geometry boxes overlap by more than a tolerance. */
function overlaps(left: CellSummary, right: CellSummary, tolerance = 4): boolean {
  if (left.x === undefined || left.y === undefined || left.width === undefined || left.height === undefined) return false
  if (right.x === undefined || right.y === undefined || right.width === undefined || right.height === undefined) return false
  const overlapX = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
  const overlapY = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
  return overlapX > tolerance && overlapY > tolerance
}

describe('template catalog', () => {
  it('declares categories, a license and unique bilingual entries', () => {
    expect(catalog.version).toBe(1)
    expect(catalog.license).toBe('Apache-2.0')
    expect(catalog.categories.length).toBeGreaterThanOrEqual(4)
    expect(catalog.templates.length).toBeGreaterThanOrEqual(8)
    const ids = catalog.templates.map(entry => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    const categoryIds = new Set(catalog.categories.map(entry => entry.id))
    for (const entry of catalog.templates) {
      expect(entry.title.zh.length).toBeGreaterThan(0)
      expect(entry.title.en.length).toBeGreaterThan(0)
      expect(entry.description.zh.length).toBeGreaterThan(10)
      expect(entry.description.en.length).toBeGreaterThan(10)
      expect(entry.tags.length).toBeGreaterThan(0)
      expect(categoryIds.has(entry.category)).toBe(true)
    }
  })

  it('rejects malformed catalogs', () => {
    expect(() => validateCatalog({ version: 2 })).toThrow(/version/u)
    expect(() => validateCatalog({ version: 1, categories: [], templates: [] })).toThrow(/categories/u)
    const base = { version: 1, categories: [{ id: 'flowchart', title: { zh: '流程', en: 'Flow' } }] }
    const entry = {
      id: 'flow/a',
      file: 'flow-a.drawio',
      category: 'flowchart',
      title: { zh: 'A', en: 'A' },
      description: { zh: '描述描述描述', en: 'description' },
      tags: ['a'],
    }
    expect(() => validateCatalog({ ...base, templates: [entry, { ...entry }] })).toThrow(/duplicate/u)
    expect(() => validateCatalog({ ...base, templates: [{ ...entry, file: '../escape.drawio' }] })).toThrow(/file/u)
    expect(() => validateCatalog({ ...base, templates: [{ ...entry, category: 'nope' }] })).toThrow(/category/u)
    expect(() => validateCatalog({ ...base, templates: [{ ...entry, id: 'Bad Id' }] })).toThrow(/template id/u)
  })

  it('ships a parseable .drawio file with Chinese labels for every entry', () => {
    const problems: string[] = []
    for (const entry of catalog.templates) {
      try {
        const path = templateFile(entry)
        if (!path.startsWith(templatesDir())) problems.push(`${entry.id}: file escapes templates/`)
        const xml = readTemplateXml(entry)
        if (xml.length < 200) problems.push(`${entry.id}: file is too small`)
        if (xml.length > 512 * 1024) problems.push(`${entry.id}: file is larger than 512 KB`)
        if (/<!doctype|<!entity/iu.test(xml)) problems.push(`${entry.id}: DOCTYPE/ENTITY is not allowed`)
        if (xml.includes('<!--')) problems.push(`${entry.id}: XML comments are not allowed`)
        const file = readDiagramSource(xml)
        const summary = summarizeDiagram(file)
        const nodes = summary.pages.flatMap(page => page.nodes)
        const edges = summary.pages.flatMap(page => page.edges)
        if (summary.pages.length !== 1) problems.push(`${entry.id}: needs exactly one page, found ${summary.pages.length}`)
        if (nodes.length < 4) problems.push(`${entry.id}: needs at least 4 nodes, found ${nodes.length}`)
        if (edges.length < 2) problems.push(`${entry.id}: needs at least 2 edges, found ${edges.length}`)
        const chinese = nodes.filter(node => /[\u4e00-\u9fff]/u.test(node.label)).length
        if (chinese < 3) problems.push(`${entry.id}: needs at least 3 Chinese labels, found ${chinese}`)
        for (const edge of edges) {
          if (!nodes.some(node => node.id === edge.source)) problems.push(`${entry.id}: edge ${edge.id} source ${edge.source ?? '?'} is missing`)
          if (!nodes.some(node => node.id === edge.target)) problems.push(`${entry.id}: edge ${edge.id} target ${edge.target ?? '?'} is missing`)
        }
      } catch (error) {
        problems.push(`${entry.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('keeps sibling shapes from overlapping on the layout grid', () => {
    const problems: string[] = []
    for (const entry of catalog.templates) {
      try {
        const summary = summarizeDiagram(readDiagramSource(readTemplateXml(entry)))
        for (const page of summary.pages) {
          const groups = new Map<string, CellSummary[]>()
          for (const node of page.nodes) {
            if (OVERLAY.test(node.style ?? '')) continue
            if (node.x === undefined || node.y === undefined) continue
            const key = node.parent ?? '1'
            const group = groups.get(key) ?? []
            group.push(node)
            groups.set(key, group)
          }
          for (const [parent, nodes] of groups) {
            for (let left = 0; left < nodes.length; left += 1) {
              for (let right = left + 1; right < nodes.length; right += 1) {
                const a = nodes[left]!
                const b = nodes[right]!
                if (overlaps(a, b)) problems.push(`${entry.id}: nodes ${a.id} and ${b.id} overlap (parent ${parent})`)
              }
            }
          }
        }
      } catch (error) {
        problems.push(`${entry.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })
})

describe('template search', () => {
  it('lists everything without filters', () => {
    expect(searchTemplates(catalog)).toHaveLength(catalog.templates.length)
    const text = renderCatalogText(catalog, searchTemplates(catalog))
    expect(text).toContain(`内置模板 ${catalog.templates.length} 个`)
    expect(text).toContain('drawio_template')
    expect(text).toContain('flow/login')
  })

  it('matches Chinese keywords, tags and categories', () => {
    expect(searchTemplates(catalog, { query: '登录' }).map(entry => entry.id)).toEqual(expect.arrayContaining(['flow/login', 'seq/login']))
    expect(searchTemplates(catalog, { query: 'microservice' }).map(entry => entry.id)).toContain('arch/microservices')
    expect(searchTemplates(catalog, { query: '登录 流程' }).map(entry => entry.id)).toContain('flow/login')
    expect(searchTemplates(catalog, { category: 'flowchart' }).every(entry => entry.category === 'flowchart')).toBe(true)
    expect(searchTemplates(catalog, { category: 'flowchart', query: '登录' }).map(entry => entry.id)).toEqual(['flow/login'])
    expect(searchTemplates(catalog, { query: '不存在的关键词' })).toHaveLength(0)
    expect(() => searchTemplates(catalog, { category: 'nope' })).toThrow(/unknown template category/u)
  })

  it('renders a compact empty result with the category hint', () => {
    const text = renderCatalogText(catalog, searchTemplates(catalog, { query: '不存在的关键词' }), { query: '不存在的关键词' })
    expect(text).toContain('匹配到 0 个模板')
    expect(text).toContain('flowchart')
  })

  it('exposes a flat entry view and category titles for the tool result', () => {
    const entry = catalog.templates.find(value => value.id === 'flow/login')!
    expect(listEntry(entry)).toMatchObject({ id: 'flow/login', category: 'flowchart', title: entry.title.zh })
    expect(categoryTitle(catalog, 'flowchart')).toBe('流程与判断')
  })
})


describe('remote catalogs', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  const remoteCatalog = {
    version: 1,
    categories: [{ id: 'community', title: { zh: '社区模板', en: 'Community' } }],
    templates: [{
      id: 'community/kanban',
      file: 'templates/kanban.drawio',
      category: 'community',
      title: { zh: '看板模板', en: 'Kanban' },
      description: { zh: '来自社区目录的看板模板', en: 'A community kanban template' },
      tags: ['看板', 'kanban'],
    }],
  }

  it('rejects non-HTTPS, credentialed and private URLs', () => {
    expect(() => assertRemoteUrl('http://example.com/c.json')).toThrow(/HTTPS/u)
    expect(() => assertRemoteUrl('https://user:pass@example.com/c.json')).toThrow(/credentials/u)
    expect(() => assertRemoteUrl('https://localhost/c.json')).toThrow(/private or loopback/u)
    expect(() => assertRemoteUrl('https://127.0.0.1/c.json')).toThrow(/private or loopback/u)
    expect(() => assertRemoteUrl('https://192.168.1.4/c.json')).toThrow(/private or loopback/u)
    expect(assertRemoteUrl('https://example.com/c.json').hostname).toBe('example.com')
  })

  it('fetches, validates and resolves a remote catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(remoteCatalog), { status: 200 })))
    const remote = await fetchRemoteCatalog('https://templates.example.com/gallery/catalog.json')
    expect(remote.catalogUrl).toBe('https://templates.example.com/gallery/catalog.json')
    expect(remote.catalog.templates).toHaveLength(1)
    const entry = remote.catalog.templates[0]!
    expect(entry.source).toBe('remote')
    expect(entry.catalogUrl).toBe('https://templates.example.com/gallery/catalog.json')
    // A relative file resolves against the catalog URL.
    expect(entry.file).toBe('https://templates.example.com/gallery/templates/kanban.drawio')
    expect(listEntry(entry).source).toBe('remote')
    // The cached catalog returns without another request.
    await fetchRemoteCatalog('https://templates.example.com/gallery/catalog.json')
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1)
  })

  it('reports HTTP, parse and size failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    await expect(fetchRemoteCatalog('https://templates.example.com/a/catalog.json')).rejects.toThrow(/HTTP 500/u)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', { status: 200 })))
    await expect(fetchRemoteCatalog('https://templates.example.com/b/catalog.json')).rejects.toThrow(/not valid JSON/u)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(600 * 1024), { status: 200 })))
    await expect(fetchRemoteCatalog('https://templates.example.com/c/catalog.json')).rejects.toThrow(/exceeds/u)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(fetchRemoteCatalog('https://templates.example.com/d/catalog.json')).rejects.toThrow(/could not be fetched/u)
  })

  it('rejects remote catalogs whose file URL is not HTTPS', async () => {
    const bad = { ...remoteCatalog, templates: [{ ...remoteCatalog.templates[0], file: 'http://example.com/x.drawio' }] }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(bad), { status: 200 })))
    await expect(fetchRemoteCatalog('https://templates.example.com/e/catalog.json')).rejects.toThrow(/HTTPS/u)
  })

  it('merges catalogs with the bundled entries first and unique ids', () => {
    const bundled = loadCatalog()
    const remote = validateCatalog(remoteCatalog, { remote: true, catalogUrl: 'https://templates.example.com/gallery/catalog.json' })
    const merged = mergeCatalogs(bundled, remote)
    expect(merged.templates).toHaveLength(bundled.templates.length + 1)
    expect(merged.templates[0]!.source).toBe('builtin')
    expect(merged.templates.at(-1)!.id).toBe('community/kanban')
    expect(merged.categories.map(entry => entry.id)).toContain('community')
    // A duplicate id keeps the bundled entry.
    const duplicate = { ...remoteCatalog, templates: [{ ...remoteCatalog.templates[0], id: bundled.templates[0]!.id }] }
    const withDuplicate = mergeCatalogs(bundled, validateCatalog(duplicate, { remote: true, catalogUrl: 'https://templates.example.com/gallery/catalog.json' }))
    expect(withDuplicate.templates).toHaveLength(bundled.templates.length)
    expect(withDuplicate.templates[0]!.source).toBe('builtin')
  })

  it('reads XML from disk or over HTTPS depending on the source', async () => {
    const builtin = loadCatalog().templates[0]!
    expect(await fetchTemplateXml(builtin)).toBe(readTemplateXml(builtin))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>', { status: 200 })))
    const remoteEntry = validateCatalog(remoteCatalog, { remote: true, catalogUrl: 'https://templates.example.com/gallery/catalog.json' }).templates[0]!
    expect(await fetchTemplateXml(remoteEntry)).toContain('<mxGraphModel>')
    expect(() => templateFile(remoteEntry)).toThrow(/remote entry/u)
  })
})
