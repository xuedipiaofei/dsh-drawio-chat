/**
 * draw.io inline surface copy: zh is the key source, en mirrors every key.
 */

export const zh = {
  'panel.title': 'Draw.io 图表',
  'panel.intro': '让模型画 draw.io 图：聊天里直接出现可缩放的本地视图，不登录、不开外部服务。',
  'row.title': 'draw.io 图表',
  'row.rendering': '正在渲染图表…',
  'row.renderFailed': '图表渲染失败：{error}',
  'row.openInDrawio': '在 draw.io 打开',
  'row.download': '下载 .drawio',
  'entry.loading': '正在载入 draw.io 查看器…',
} as const

/** Locale key union for the slot map. */
export type DrawioKey = keyof typeof zh

export const en: Record<DrawioKey, string> = {
  'panel.title': 'Draw.io diagrams',
  'panel.intro': 'Let the model draw draw.io diagrams: a zoomable local viewer appears right in the chat, with no draw.io account and no external service.',
  'row.title': 'draw.io diagram',
  'row.rendering': 'Rendering the diagram…',
  'row.renderFailed': 'Failed to render the diagram: {error}',
  'row.openInDrawio': 'Open in draw.io',
  'row.download': 'Download .drawio',
  'entry.loading': 'Loading the draw.io viewer…',
}
