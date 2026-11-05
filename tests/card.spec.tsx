/** The inline card renders a sandboxed viewer iframe and its actions. */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { DrawioCallView } from '../src/client/DrawioCallView.tsx'

const XML = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>'

describe('DrawioCallView', () => {
  it('renders a sandboxed viewer iframe for a result', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<DrawioCallView phase="result" block={{ args: { xml: XML, title: 'Login' }, meta: { title: 'Login' } }} />)
    })
    for (let tick = 0; tick < 5; tick += 1) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    }
    const iframe = container.querySelector('iframe')
    expect(iframe).toBeInstanceOf(HTMLIFrameElement)
    expect(iframe?.getAttribute('sandbox')).toContain('allow-scripts')
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(iframe?.getAttribute('src') ?? '').not.toContain('viewer.diagrams.net')
    expect(iframe?.getAttribute('srcdoc') ?? '').toContain('viewer-static.min.js')
    expect(iframe?.getAttribute('srcdoc') ?? '').toContain('drawio-graph')
    const labels = Array.from(container.querySelectorAll('button')).map(button => button.textContent?.trim())
    expect(labels).toContain('下载 .drawio')
    expect(labels).toContain('在 draw.io 打开')
    act(() => { root.unmount() })
    container.remove()
  })
})
