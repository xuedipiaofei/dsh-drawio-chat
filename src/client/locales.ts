/**
 * draw.io inline surface copy: zh is the key source, en mirrors every key.
 */

export const zh = {
  'drawio.title': 'draw.io 图表',
  'drawio.rendering': '正在渲染图表…',
  'drawio.renderFailed': '图表渲染失败：{error}',
  'drawio.openInDrawio': '在 draw.io 打开',
  'drawio.download': '下载 .drawio',
  'drawio.fileRead': '已读取图表',
  'drawio.fileApply': '已更新图表',
  'drawio.fileUndo': '已回退图表',
  'drawio.fileTemplate': '从模板创建图表',
  'drawio.templateCatalog': 'draw.io 模板',
  'drawio.betterViewer': 'draw.io 画布',
  'drawio.betterNoContent': '这里没有可预览的图表内容。',
  'drawio.betterTooLarge': '图表文件过大（{size} 字节），没有加载到画布。',
  'drawio.fileLoading': '正在读取图表文件…',
  'drawio.fileLoadFailed': '读取图表失败：{error}',
  'drawio.revision': '版本',
  'sidebar.refresh': '刷新',
  'sidebar.loading': '正在读取 .drawio…',
  'sidebar.loadFailed': '打开图表失败：{error}',
  'sidebar.noSession': '无法从标签地址确定所在会话。',
  'drawio.exportSvg': '导出 SVG',
  'drawio.exportFailed': 'SVG 导出失败。',
  'drawio.exportPng': '导出 PNG',
  'drawio.exportPngFailed': 'PNG 导出失败：{error}',
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
  'drawio.fileRead': 'Diagram read',
  'drawio.fileApply': 'Diagram updated',
  'drawio.fileUndo': 'Diagram restored',
  'drawio.fileTemplate': 'Diagram created from template',
  'drawio.templateCatalog': 'draw.io templates',
  'drawio.betterViewer': 'draw.io canvas',
  'drawio.betterNoContent': 'There is no diagram content to preview here.',
  'drawio.betterTooLarge': 'The diagram file is too large ({size} bytes) to load into the canvas.',
  'drawio.fileLoading': 'Reading the diagram file…',
  'drawio.fileLoadFailed': 'Could not read the diagram: {error}',
  'drawio.revision': 'rev',
  'sidebar.refresh': 'Refresh',
  'sidebar.loading': 'Reading the .drawio file…',
  'sidebar.loadFailed': 'Could not open the diagram: {error}',
  'sidebar.noSession': 'Could not resolve the session from the tab address.',
  'drawio.exportSvg': 'Export SVG',
  'drawio.exportFailed': 'SVG export failed.',
  'drawio.exportPng': 'Export PNG',
  'drawio.exportPngFailed': 'PNG export failed: {error}',
  'drawio.expand': 'Expand',
  'drawio.collapse': 'Shrink',
}
