import { MODULE_BY_KEY } from '@/data/modules'
import {
  StorageConflictError,
  allReleases,
  allRows,
  listRows,
  resetRows,
  saveRows,
  saveState,
} from '@/data/local-store'
import type {
  ActionResult,
  ChartRelease,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  StatItem,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 进入发布类状态前必须补齐的字段：缺哪项就在报错里点名列哪项，补齐后才允许流转。
const PUBLISH_REQUIRED_FIELDS: Record<string, Record<string, string[]>> = {
  chart: {
    待发布: ['数据来源', 'X轴字段', 'Y轴字段'],
    已发布: ['数据来源', 'X轴字段', 'Y轴字段'],
  },
}

// 允许删除的状态：只放未发布的记录，已发布/已下线的一律拒绝，保护发布记录与发布历史。
const DELETABLE_STATUSES: Record<string, string[]> = {
  chart: ['草稿', '待发布'],
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 统计卡片实时计算：指标名带「总数」取全量条数，其余按状态名计数。
// 不读筛选条件、不依赖任何缓存副本，筛选后的视图也不会把计数变成局部数量。
export function listStats(key: string): StatItem[] {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  return meta.metrics.map((label) => {
    if (label.includes('总数')) {
      return { label, value: rows.length }
    }
    const status = meta.statuses.find((item) => label.includes(item))
    return { label, value: status ? rows.filter((row) => row.status === status).length : 0 }
  })
}

// 状态图例同样基于全量数据统计，草稿、待发布、已发布分开计数。
export function countByStatus(key: string): Record<string, number> {
  const meta = moduleMeta(key)
  const counts: Record<string, number> = {}
  for (const status of meta.statuses) {
    counts[status] = 0
  }
  for (const row of listRows(key)) {
    const status = String(row.status)
    counts[status] = (counts[status] ?? 0) + 1
  }
  return counts
}

function conflictMessage(error: unknown): string | null {
  return error instanceof StorageConflictError ? error.message : null
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const required = PUBLISH_REQUIRED_FIELDS[key]?.[target] ?? []
  const missing = required.filter((field) => String(rows[index][field] ?? '').trim() === '')
  if (missing.length > 0) {
    return { ok: false, message: `${meta.entity}缺少必填项：${missing.join('、')}，请补齐后再${action}` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  let releases: ChartRelease[] | undefined
  if (key === 'chart' && target === '已发布') {
    releases = publishChartRelease(updated)
  } else if (key === 'chart' && target === '已下线') {
    releases = retireChartRelease(id)
  }
  try {
    saveState(key, next, releases)
  } catch (error) {
    const message = conflictMessage(error)
    if (message) {
      return { ok: false, message }
    }
    throw error
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 发布图表：同一配置只保留一个当前版本，旧版本全部转历史且不可再改回；
// 每次发布生成新的发布序号（按配置递增），下线后重新上线也会拿到新序号。
function publishChartRelease(row: EntryRow): ChartRelease[] {
  const chartId = Number(row.id)
  const meta = moduleMeta('chart')
  const existing = allReleases()
  const version = existing
    .filter((item) => item.chartId === chartId)
    .reduce((max, item) => Math.max(max, item.version), 0) + 1
  const snapshot: Record<string, string | number | boolean> = {}
  for (const field of meta.fields) {
    snapshot[field] = row[field] ?? ''
  }
  const publishedAt = new Date().toISOString()
  const release: ChartRelease = {
    chartId,
    version,
    name: String(row['图表名称'] ?? ''),
    snapshot,
    publishedAt,
    state: 'current',
  }
  return [
    ...existing.map((item) =>
      item.chartId === chartId && item.state === 'current'
        ? { ...item, state: 'history' as const, offlineAt: item.offlineAt ?? publishedAt }
        : item,
    ),
    release,
  ]
}

// 下线图表：当前版本转历史，计数随之从已发布迁出，历史版本保留不可回写。
function retireChartRelease(chartId: number): ChartRelease[] {
  const now = new Date().toISOString()
  return allReleases().map((item) =>
    item.chartId === chartId && item.state === 'current'
      ? { ...item, state: 'history' as const, offlineAt: item.offlineAt ?? now }
      : item,
  )
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function nextCode(rows: EntryRow[], field: string): string {
  // 从已有编号里推前缀和最大序号，例如 CHAR-0003 → CHAR-0004
  let prefix = ''
  let max = 0
  for (const row of rows) {
    const match = /^([A-Za-z]+)-(\d+)$/.exec(String(row[field] ?? ''))
    if (!match) {
      continue
    }
    prefix = prefix || match[1]
    if (match[1] === prefix) {
      max = Math.max(max, Number(match[2]))
    }
  }
  return `${prefix || 'ITEM'}-${String(max + 1).padStart(4, '0')}`
}

export function createEntry(key: string, values: Record<string, string>): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const row: EntryRow = {
    id: nextId(rows),
    status: meta.statuses[0],
    pending: true,
    abnormal: false,
  }
  for (const field of meta.fields) {
    row[field] = values[field] ?? ''
  }
  if (String(row[meta.fields[0]] ?? '').trim() === '') {
    row[meta.fields[0]] = nextCode(rows, meta.fields[0])
  }
  try {
    saveRows(key, [...rows, row])
  } catch (error) {
    const message = conflictMessage(error)
    if (message) {
      return { ok: false, message }
    }
    throw error
  }
  return { ok: true, message: `${meta.entity}已登记，编号 ${row[meta.fields[0]]}` }
}

export function updateEntry(key: string, id: number, values: Record<string, string>): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const updated: EntryRow = { ...rows[index] }
  for (const field of meta.fields) {
    if (field in values) {
      updated[field] = values[field]
    }
  }
  // 编号不允许改：发布序号挂在配置上，改名不改编号，发布序号保持不变
  updated[meta.fields[0]] = rows[index][meta.fields[0]]
  const next = [...rows]
  next[index] = updated
  try {
    saveRows(key, next)
  } catch (error) {
    const message = conflictMessage(error)
    if (message) {
      return { ok: false, message }
    }
    throw error
  }
  return { ok: true, message: `${meta.entity}已保存` }
}

export function deleteEntry(key: string, id: number): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const allowed = DELETABLE_STATUSES[key] ?? ['草稿']
  if (!allowed.includes(String(rows[index].status))) {
    return { ok: false, message: `只有未发布的${meta.entity}（${allowed.join('、')}）才能删除，已发布记录不受影响` }
  }
  try {
    saveRows(key, rows.filter((row) => Number(row.id) !== id))
  } catch (error) {
    const message = conflictMessage(error)
    if (message) {
      return { ok: false, message }
    }
    throw error
  }
  return { ok: true, message: `${meta.entity}已删除` }
}

export type ChartReleaseView = ChartRelease & {
  code: string
  displayName: string
}

// 发布视图数据：当前版本排在前面，历史版本按发布时间倒序；名称跟随配置现名（改名不改发布序号）。
export function listChartReleases(): ChartReleaseView[] {
  const charts = listRows('chart')
  const byId = new Map(charts.map((row) => [Number(row.id), row]))
  return allReleases()
    .map((release) => {
      const row = byId.get(release.chartId)
      return {
        ...release,
        code: String(row?.['图表编号'] ?? `CHART-${release.chartId}`),
        displayName: String(row?.['图表名称'] ?? release.name),
      }
    })
    .sort((a, b) => {
      if (a.state !== b.state) {
        return a.state === 'current' ? -1 : 1
      }
      return b.publishedAt.localeCompare(a.publishedAt)
    })
}

// 报告生成等入口的选择器选项：只列当前发布版本，与计数读的是同一份数据。
export function publishedChartOptions(): { value: string; label: string }[] {
  return listChartReleases()
    .filter((item) => item.state === 'current')
    .map((item) => ({
      value: `${item.code}-v${item.version}`,
      label: `${item.displayName}（${item.code} · 发布序号 v${item.version}）`,
    }))
}

export type ReleaseDiff = {
  hasPrevious: boolean
  diffs: { field: string; before: string; after: string; changed: boolean }[]
}

// 发布差异：与同一配置的上一个版本逐字段对比，变化的字段由页面高亮。
export function diffChartRelease(chartId: number, version: number): ReleaseDiff {
  const previous = allReleases()
    .filter((item) => item.chartId === chartId && item.version < version)
    .sort((a, b) => b.version - a.version)[0]
  const current = allReleases().find((item) => item.chartId === chartId && item.version === version)
  const fields = moduleMeta('chart').fields
  return {
    hasPrevious: Boolean(previous),
    diffs: fields.map((field) => {
      const before = previous ? String(previous.snapshot[field] ?? '') : ''
      const after = current ? String(current.snapshot[field] ?? '') : ''
      return { field, before, after, changed: Boolean(previous) && before !== after }
    }),
  }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
