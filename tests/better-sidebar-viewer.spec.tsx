/** The better-sidebar canvas viewer renders the sandboxed draw.io viewer. */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { DrawioBetterSidebarViewer } from '../src/client/BetterSidebarViewer.tsx'

const XML = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="n1" value="Login" vertex="1" parent="1"><mxGeometry x="10" y="10" width="100" height="40" as="geometry"/></mxCell></root></mxGraphModel>'

/** Flush microtasks/timers a few times. */
async function flush(): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
}

describe('DrawioBetterSidebarViewer', () => {
  it('renders the file text through the sandboxed draw.io viewer', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<DrawioBetterSidebarViewer path="/ws/diagrams/login.drawio" title="login.drawio" content={XML} />)
    })
    await flush()
    const iframe = container.querySelector('iframe')
    expect(iframe).toBeInstanceOf(HTMLIFrameElement)
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts allow-popups')
    expect(iframe?.getAttribute('srcDoc') ?? '').toContain('viewer-static.min.js')
    expect(container.textContent).toContain('login.drawio')
    expect(container.textContent).toContain('在 draw.io 打开')
    act(() => { root.unmount() })
    container.remove()
  })

  it('explains an over-limit file instead of rendering an empty canvas', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<DrawioBetterSidebarViewer path="/ws/big.drawio" largeFile={{ size: 9_000_000 }} />)
    })
    await flush()
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.textContent).toContain('过大')
    expect(container.textContent).toContain('9000000')
    act(() => { root.unmount() })
    container.remove()
  })
})
