/**
 * Interop fixture: a real `.drawio` produced by the dsh-drawai plugin
 * (fourzkw/dsh-drawai, MIT) — mxfile carrier, `<object>`-wrapped cells and
 * several layers. Reading it must not throw and must see its cells.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readDiagramSource, serializeDiagram, summarizeDiagram } from '../src/model/diagram.ts'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'dsh-drawai-demo.drawio')

describe('interop with a real .drawio file', () => {
  it('parses the mxfile, summarizes nodes/edges and keeps wrapped cells', () => {
    const file = readDiagramSource(readFileSync(FIXTURE, 'utf8'))
    expect(file.wrapper).toBe('mxfile')
    expect(file.pages.length).toBeGreaterThan(0)
    const summary = summarizeDiagram(file)
    expect(summary.nodeCount).toBeGreaterThan(0)
    expect(summary.edgeCount).toBeGreaterThan(0)
    // Cells the op set does not know (drawai's wrapped metadata cell) survive.
    expect(serializeDiagram(file)).toContain('drawaiMeta="1"')
  })
})
