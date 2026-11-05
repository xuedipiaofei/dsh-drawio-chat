/** Bounded per-file undo snapshots. */
import { describe, expect, it } from 'vitest'
import { SnapshotStore } from '../src/model/undo.ts'

describe('SnapshotStore', () => {
  it('returns versions in reverse order and pops them', () => {
    const store = new SnapshotStore()
    store.remember('/w/a.drawio', 'v1')
    store.remember('/w/a.drawio', 'v2')
    expect(store.undo('/w/a.drawio')).toBe('v2')
    expect(store.undo('/w/a.drawio')).toBe('v1')
    expect(store.undo('/w/a.drawio')).toBeUndefined()
  })

  it('bounds the stack and keeps paths independent', () => {
    const store = new SnapshotStore(2)
    for (const value of ['v1', 'v2', 'v3']) store.remember('/w/a.drawio', value)
    expect(store.depthOf('/w/a.drawio')).toBe(2)
    expect(store.undo('/w/a.drawio')).toBe('v3')
    expect(store.undo('/w/a.drawio')).toBe('v2')
    expect(store.undo('/w/a.drawio')).toBeUndefined()
    expect(store.undo('/w/b.drawio')).toBeUndefined()
  })
})
