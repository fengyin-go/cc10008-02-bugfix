/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type StatItem = {
  label: string
  value: number
}

/** 图表发布版本：每次发布生成一条，同一配置同一时间只有一条 current，历史版本不可回写。 */
export type ChartRelease = {
  chartId: number
  /** 发布序号：按图表配置递增，重新上线会拿到新序号，改名不影响 */
  version: number
  /** 发布时的图表名称快照 */
  name: string
  /** 发布时的字段快照，用于发布差异对比 */
  snapshot: Record<string, string | number | boolean>
  publishedAt: string
  state: 'current' | 'history'
  offlineAt?: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
