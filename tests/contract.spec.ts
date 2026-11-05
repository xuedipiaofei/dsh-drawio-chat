/**
 * Bundle contract: the manifest, the profile patch and the cordis surface agree
 * on the package name and the row id.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { name, inject } from '../src/index.ts'

describe('bundle contract', () => {
  it('exposes the stable cordis identity', () => {
    expect(name).toBe('drawio-inline')
    expect(inject).toEqual(['webServer'])
  })

  it('declares the bundle patch and the web client half', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      name: string
      dsh: { bundle?: { patch?: string }; client?: { platform?: string } }
    }
    expect(pkg.name).toBe('dsh-drawio-inline')
    expect(pkg.dsh.bundle?.patch).toBe('./cordis.patch.yml')
    expect(pkg.dsh.client?.platform).toBe('web')
    const patch = readFileSync(join(process.cwd(), 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('id: ui-drawio-inline')
    expect(patch).toContain("name: 'dsh-drawio-inline'")
  })
})
