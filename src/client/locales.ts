/**
 * draw.io inline surface copy: zh is the key source, en mirrors every key.
 */

export const zh = {
  'drawio.title': 'draw.io 图表',
  'drawio.rendering': '正在渲染图表…',
  'drawio.renderFailed': '图表渲染失败：{error}',
  'drawio.openInDrawio': '在 draw.io 打开',
  'drawio.download': '下载 .drawio',
  'drawio.exportSvg': '导出 SVG',
  'drawio.exportFailed': 'SVG 导出失败。',
  'drawio.expand': '放大',
  'drawio.collapse': '缩小',
} as const

/** Locale key union for the slot map. */
export type DrawioKey = keyof typeof zh

export const en: Record<DrawioKey, string> = {
  'drawio.title': 'draw.io diagram',
  'drawio.rendering': 'Rendering the diagram…',
  'drawio.renderFailed': 'Failed to render the diagram: {error}',
  'drawio.openInDrawio': 'Open in draw.io',
  'drawio.download': 'Download .drawio',
  'drawio.exportSvg': 'Export SVG',
  'drawio.exportFailed': 'SVG export failed.',
  'drawio.expand': 'Expand',
  'drawio.collapse': 'Shrink',
}
