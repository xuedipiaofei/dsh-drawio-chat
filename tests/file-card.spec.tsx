/** The read/apply/undo card fetches the file from the preview route and renders it. */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DrawioFileCard } from '../src/client/DrawioFileCard.tsx'

const XML = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="n1" value="Login" vertex="1" parent="1"><mxGeometry x="10" y="10" width="100" height="40" as="geometry"/></mxCell></root></mxGraphModel>'

/** Flush microtasks/timers a few times. */
async function flush(): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
}

describe('DrawioFileCard', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

  it('fetches the updated file through the preview route and renders a sandboxed viewer', async () => {
    const fetchMock = vi.fn(async () => new Response(XML, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<DrawioFileCard mode="apply" phase="result" block={{ meta: { path: '/ws/diagrams/a.drawio', revision: 'abcdef1234567890' } }} />)
    })
    await flush()
    expect(fetchMock).toHaveBeenCalledWith('/api/dsh-drawio-chat/diagram?path=%2Fws%2Fdiagrams%2Fa.drawio', expect.anything())
    const iframe = container.querySelector('iframe')
    expect(iframe).toBeInstanceOf(HTMLIFrameElement)
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts allow-popups')
    expect(container.textContent).toContain('已更新图表')
    expect(container.textContent).toContain('abcdef12')
    const labels = Array.from(container.querySelectorAll('button')).map(button => button.textContent?.trim())
    expect(labels).toContain('导出 PNG')
    act(() => { root.unmount() })
    container.remove()
  })

  it('shows a readable error when the preview route refuses the file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 403 })))
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<DrawioFileCard mode="read" phase="result" block={{ meta: { path: '/etc/passwd' } }} />)
    })
    await flush()
    expect(container.textContent).toContain('读取图表失败')
    expect(container.querySelector('iframe')).toBeNull()
    act(() => { root.unmount() })
    container.remove()
  })
})
