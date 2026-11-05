/** Sidebar *.drawio tab: address parsing, fetch through the host route, viewer. */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveTabAddress, SidebarDiagram } from '../src/client/SidebarDiagram.tsx'

const XML = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="n1" value="Login" vertex="1" parent="1"><mxGeometry x="10" y="10" width="100" height="40" as="geometry"/></mxCell></root></mxGraphModel>'

async function flush(): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

describe('resolveTabAddress', () => {
  it('parses session-relative dsh-resource file addresses', () => {
    expect(resolveTabAddress('dsh-resource://file/session/sess-1/diagrams/a.drawio')).toEqual({ sessionId: 'sess-1', path: 'diagrams/a.drawio' })
    expect(resolveTabAddress('dsh-resource://file/session/sess-1/diagrams/a%20b.drawio')).toEqual({ sessionId: 'sess-1', path: 'diagrams/a b.drawio' })
    expect(resolveTabAddress('dsh-resource://file/diagrams/a.drawio', 'sess-2')).toEqual({ sessionId: 'sess-2', path: 'diagrams/a.drawio' })
    expect(resolveTabAddress(undefined)).toBeUndefined()
    expect(resolveTabAddress('https://example.com/a.drawio')).toBeUndefined()
  })
})

describe('SidebarDiagram', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

  it('fetches the file for the tab address and renders a sandboxed viewer', async () => {
    const fetchMock = vi.fn(async () => new Response(XML, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<SidebarDiagram useTabInfo={() => ({ tab: { visible: true, navigation: { address: 'dsh-resource://file/session/sess-1/diagrams/login.drawio' } } })} />)
    })
    await flush()
    expect(fetchMock).toHaveBeenCalledWith('/api/dsh-drawio-chat/open?session=sess-1&path=diagrams%2Flogin.drawio', expect.anything())
    const iframe = container.querySelector('iframe')
    expect(iframe).toBeInstanceOf(HTMLIFrameElement)
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts allow-popups')
    expect(container.textContent).toContain('login.drawio')
    const labels = Array.from(container.querySelectorAll('button')).map(button => button.textContent?.trim())
    expect(labels).toEqual(expect.arrayContaining(['刷新', '下载 .drawio', '导出 SVG', '导出 PNG', '在 draw.io 打开']))
    act(() => { root.unmount() })
    container.remove()
  })

  it('shows an error when the tab address cannot be resolved', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<SidebarDiagram />) })
    await flush()
    expect(container.textContent).toContain('无法从标签地址确定所在会话')
    act(() => { root.unmount() })
    container.remove()
  })
})
