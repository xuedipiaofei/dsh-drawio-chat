/** The template card: catalog listings render text, created diagrams render the file viewer. */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DrawioTemplateCard } from '../src/client/DrawioTemplateCard.tsx'

const XML = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="n1" value="Login" vertex="1" parent="1"><mxGeometry x="10" y="10" width="100" height="40" as="geometry"/></mxCell></root></mxGraphModel>'

/** Flush microtasks/timers a few times. */
async function flush(): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
}

describe('DrawioTemplateCard', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

  it('renders the catalog listing text when the tool only listed templates', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <DrawioTemplateCard
          phase="result"
          block={{
            meta: { action: 'listed' },
            content: [{ type: 'text', text: '内置模板 12 个\n- flow/login 系统登录流程' }],
          }}
        />,
      )
    })
    await flush()
    expect(container.textContent).toContain('draw.io 模板')
    expect(container.textContent).toContain('内置模板 12 个')
    expect(container.querySelector('iframe')).toBeNull()
    act(() => { root.unmount() })
    container.remove()
  })

  it('renders the created diagram through the file viewer', async () => {
    const fetchMock = vi.fn(async () => new Response(XML, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <DrawioTemplateCard
          phase="result"
          block={{ meta: { action: 'created', title: '系统登录流程', path: '/ws/diagrams/flow-login.drawio', revision: 'abcdef1234567890', templateId: 'flow/login' } }}
        />,
      )
    })
    await flush()
    expect(fetchMock).toHaveBeenCalledWith('/api/dsh-drawio-chat/diagram?path=%2Fws%2Fdiagrams%2Fflow-login.drawio', expect.anything())
    const iframe = container.querySelector('iframe')
    expect(iframe).toBeInstanceOf(HTMLIFrameElement)
    expect(container.textContent).toContain('从模板创建图表')
    expect(container.textContent).toContain('flow-login.drawio')
    act(() => { root.unmount() })
    container.remove()
  })
})
