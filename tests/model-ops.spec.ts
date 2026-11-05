/** Semantic ops: node/edge creation, label/style patches, move, remove, order. */
import { describe, expect, it } from 'vitest'
import { readDiagramSource, serializeDiagram, summarizeDiagram } from '../src/model/diagram.ts'
import { applyOps } from '../src/model/ops.ts'

const EMPTY = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>'

function doc(): ReturnType<typeof readDiagramSource> {
  return readDiagramSource(EMPTY)
}

describe('addNode / addEdge', () => {
  it('creates a node, then an edge between two nodes, and the summary sees both', () => {
    const file = doc()
    const first = applyOps(file, [{ op: 'addNode', id: 'a', label: 'Login', x: 40, y: 40 }])
    const second = applyOps(file, [{ op: 'addNode', id: 'b', label: 'Home', x: 240, y: 40, style: 'ellipse;' }])
    const third = applyOps(file, [{ op: 'addEdge', id: 'e', source: 'a', target: 'b', label: 'ok' }])
    expect([...first.changed, ...second.changed, ...third.changed]).toEqual(['a', 'b', 'e'])
    const summary = summarizeDiagram(readDiagramSource(serializeDiagram(file)))
    expect(summary.nodeCount).toBe(2)
    expect(summary.edgeCount).toBe(1)
    expect(summary.pages[0].nodes[0]).toMatchObject({ id: 'a', label: 'Login', x: 40, width: 120 })
    expect(summary.pages[0].edges[0]).toMatchObject({ id: 'e', source: 'a', target: 'b', label: 'ok' })
  })

  it('rejects duplicate ids, missing endpoints and missing parents', () => {
    const file = doc()
    applyOps(file, [{ op: 'addNode', id: 'a', label: 'A', x: 0, y: 0 }])
    expect(() => applyOps(file, [{ op: 'addNode', id: 'a', label: 'A2', x: 0, y: 0 }])).toThrow(/already exists/u)
    expect(() => applyOps(file, [{ op: 'addEdge', source: 'a', target: 'missing' }])).toThrow(/target "missing"/u)
    expect(() => applyOps(file, [{ op: 'addNode', id: 'c', label: 'C', x: 0, y: 0, parent: 'nope' }])).toThrow(/parent "nope"/u)
  })
})

describe('setLabel / setStyle / move', () => {
  it('patches labels on mxCell and object wrappers without dropping other attributes', () => {
    const source = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><object id="w" label="Old" keep="1"><mxCell vertex="1" parent="1"><mxGeometry x="1" y="2" width="3" height="4" as="geometry"/></mxCell></object></root></mxGraphModel>'
    const file = readDiagramSource(source)
    applyOps(file, [{ op: 'setLabel', ids: ['w'], label: 'New' }])
    const text = serializeDiagram(file)
    expect(text).toContain('label="New"')
    expect(text).toContain('keep="1"')
    expect(text).not.toContain('label="Old"')
  })

  it('merges style patches and shifts geometry', () => {
    const file = doc()
    applyOps(file, [{ op: 'addNode', id: 'a', label: 'A', x: 10, y: 10, style: 'rounded=1;' }])
    applyOps(file, [
      { op: 'setStyle', ids: ['a'], patch: 'fillColor=#dae8fc;rounded=0' },
      { op: 'move', ids: ['a'], dx: 5, dy: -3 },
    ])
    const summary = summarizeDiagram(readDiagramSource(serializeDiagram(file)))
    expect(summary.pages[0].nodes[0]).toMatchObject({ x: 15, y: 7 })
    expect(summary.pages[0].nodes[0].style).toBe('rounded=0;fillColor=#dae8fc;')
  })
})

describe('remove / order', () => {
  it('removes edges that reference a removed node', () => {
    const file = doc()
    applyOps(file, [
      { op: 'addNode', id: 'a', label: 'A', x: 0, y: 0 },
      { op: 'addNode', id: 'b', label: 'B', x: 200, y: 0 },
      { op: 'addEdge', id: 'e', source: 'a', target: 'b' },
    ])
    const result = applyOps(file, [{ op: 'remove', ids: ['a'] }])
    expect(result.changed.sort()).toEqual(['a', 'e'])
    const summary = summarizeDiagram(readDiagramSource(serializeDiagram(file)))
    expect(summary.nodeCount).toBe(1)
    expect(summary.edgeCount).toBe(0)
  })

  it('moves a cell to the front and back in z-order', () => {
    const file = doc()
    applyOps(file, [
      { op: 'addNode', id: 'a', label: 'A', x: 0, y: 0 },
      { op: 'addNode', id: 'b', label: 'B', x: 0, y: 0 },
      { op: 'addNode', id: 'c', label: 'C', x: 0, y: 0 },
    ])
    applyOps(file, [{ op: 'order', id: 'a', where: 'front' }])
    expect(summarizeDiagram(readDiagramSource(serializeDiagram(file))).pages[0].nodes.map(node => node.id)).toEqual(['b', 'c', 'a'])
    applyOps(file, [{ op: 'order', id: 'a', where: 'back' }])
    expect(summarizeDiagram(readDiagramSource(serializeDiagram(file))).pages[0].nodes.map(node => node.id)).toEqual(['a', 'b', 'c'])
  })

  it('rejects unknown ops and empty batches', () => {
    expect(() => applyOps(doc(), [])).toThrow(/non-empty/u)
    expect(() => applyOps(doc(), [{ op: 'nope' } as never])).toThrow(/unknown op/u)
    expect(() => applyOps(doc(), [{ op: 'setLabel', ids: ['ghost'], label: 'x' }])).toThrow(/does not exist/u)
  })
})
