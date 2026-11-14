import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  countByStatus,
  createEntry,
  deleteEntry,
  diffChartRelease,
  downloadEntries,
  listChartReleases,
  listEntries,
  listStats,
  moduleMeta,
  runAction as applyAction,
  updateEntry,
  type ChartReleaseView,
} from '@/api/local-service'
import type { EntryRow, StatItem } from '@/data/types'

const meta = moduleMeta('chart')
const columns = [
  "图表编号",
  "图表名称",
  "图表类型",
  "数据来源",
  "X轴字段",
  "Y轴字段",
  "配色方案",
  "刷新间隔秒"
]
const actions = [
  "提交发布",
  "发布图表",
  "下线图表"
]
const statuses = [
  "草稿",
  "待发布",
  "已发布",
  "已下线"
]
// 编号自动生成且不允许改，编辑从第二个字段开始
const editableFields = columns.slice(1)
// 发布前必须补齐的字段，表单里直接标注
const publishRequired = ["数据来源", "X轴字段", "Y轴字段"]
const deletableStatuses = ["草稿", "待发布"]

function formatTime(iso: string): string {
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleString('zh-CN', { hour12: false })
}

export default function ChartView() {
  const [rows, setRows] = useState<EntryRow[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<StatItem[]>(() => listStats(meta.key))
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>(() => countByStatus(meta.key))
  const [releases, setReleases] = useState<ChartReleaseView[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  // editingId：null 关闭表单，-1 新建，其他为正在编辑的记录 id
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const filterFields = useMemo(() => columns.slice(0, 3), [])

  const reload = useCallback(() => {
    setErrorMessage('')
    try {
      const payload = listEntries(meta.key, filters)
      setRows(payload.items)
      setTotal(payload.total)
      setStats(listStats(meta.key))
      setStatusCounts(countByStatus(meta.key))
      setReleases(listChartReleases())
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '可视化图表列表读取失败')
    }
  }, [filters])

  useEffect(() => {
    reload()
  }, [reload])

  function runAction(action: string, row: EntryRow) {
    setErrorMessage('')
    setNotice('')
    const result = applyAction(meta.key, Number(row.id), action)
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    setNotice(result.message)
    reload()
  }

  function openCreate() {
    setEditingId(-1)
    setForm(Object.fromEntries(editableFields.map((field) => [field, ''])))
    setErrorMessage('')
    setNotice('')
  }

  function openEdit(row: EntryRow) {
    setEditingId(Number(row.id))
    setForm(Object.fromEntries(editableFields.map((field) => [field, String(row[field] ?? '')])))
    setErrorMessage('')
    setNotice('')
  }

  function saveForm() {
    setErrorMessage('')
    setNotice('')
    const result =
      editingId === -1
        ? createEntry(meta.key, form)
        : updateEntry(meta.key, Number(editingId), form)
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    setNotice(`${result.message}，发布情况见下方发布视图`)
    setEditingId(null)
    reload()
  }

  function removeRow(row: EntryRow) {
    setErrorMessage('')
    setNotice('')
    const result = deleteEntry(meta.key, Number(row.id))
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    setNotice(result.message)
    reload()
  }

  const currentCount = releases.filter((item) => item.state === 'current').length
  const historyCount = releases.length - currentCount
  const detailRelease = releases.find((item) => `${item.chartId}-v${item.version}` === detailKey) ?? null
  const detailDiff = detailRelease ? diffChartRelease(detailRelease.chartId, detailRelease.version) : null
  const editingCode =
    editingId !== null && editingId !== -1
      ? String(rows.find((row) => Number(row.id) === editingId)?.['图表编号'] ?? '')
      : ''

  return (
    <section className="page" data-module="chart">
      <header className="page-head">
        <div>
          <h2>可视化图表管理</h2>
          <p className="page-desc">维护可视化图表配置的输入、执行约束与结果记录，为图表展示提供可验证的数据工程流程。</p>
        </div>
        <div className="page-actions">
          <button className="btn primary" type="button" onClick={openCreate}>
            登记图表配置
          </button>
          <button className="btn" type="button" onClick={() => downloadEntries(meta.key)}>
            导出可视化图表清单
          </button>
        </div>
      </header>

      <div className="stat-row">
        {stats.map((item) => (
          <article key={item.label} className="stat-card">
            <span className="stat-label">{item.label}</span>
            <strong className="stat-value">{item.value}</strong>
          </article>
        ))}
      </div>

      <p className="status-legend">
        {statuses.map((status: string) => (
          <span key={status} className="legend-item">
            {status}：{statusCounts[status] ?? 0}
          </span>
        ))}
      </p>

      {editingId !== null && (
        <div className="form-panel">
          <h3 className="form-title">{editingId === -1 ? '登记图表配置' : `编辑图表配置 ${editingCode}`}</h3>
          <div className="form-grid">
            {editableFields.map((field) => (
              <label key={field} className="form-item">
                <span>
                  {field}
                  {publishRequired.includes(field) && <em className="required-mark">（发布必填）</em>}
                </span>
                <input
                  value={form[field] ?? ''}
                  placeholder={`请输入${field}`}
                  onChange={(event) => setForm((prev) => ({ ...prev, [field]: event.target.value }))}
                />
              </label>
            ))}
          </div>
          <div className="form-actions">
            <button className="btn primary" type="button" onClick={saveForm}>保存</button>
            <button className="btn ghost" type="button" onClick={() => setEditingId(null)}>取消</button>
          </div>
        </div>
      )}

      <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); reload() }}>
        {filterFields.map((field) => (
          <label key={field} className="filter-item">
            <span>{field}</span>
            <input
              value={filters[field] ?? ''}
              placeholder={`按${field}检索`}
              onChange={(event) => setFilters((prev) => ({ ...prev, [field]: event.target.value }))}
            />
          </label>
        ))}
        <button className="btn" type="submit">查询</button>
        <button className="btn ghost" type="button" onClick={() => setFilters({})}>重置条件</button>
      </form>

      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              {columns.map((column) => <td key={column}>{row[column] ?? '—'}</td>)}
              <td>{row.status}</td>
              <td className="row-actions">
                {actions.map((action) => (
                  <button key={action} className="link" type="button" onClick={() => runAction(action, row)}>
                    {action}
                  </button>
                ))}
                <button className="link" type="button" onClick={() => openEdit(row)}>编辑</button>
                {deletableStatuses.includes(String(row.status)) && (
                  <button className="link" type="button" onClick={() => removeRow(row)}>删除</button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={columns.length + 2}>暂无可视化图表数据，可先登记图表配置</td>
            </tr>
          )}
        </tbody>
      </table>

      <section className="release-panel">
        <h3 className="form-title">发布视图</h3>
        <p className="page-desc">
          当前发布 {currentCount} 个 · 历史版本 {historyCount} 个；每次发布生成新的发布序号，旧版本不可回写。
        </p>
        <table className="data-table">
          <thead>
            <tr>
              <th>图表编号</th>
              <th>图表名称</th>
              <th>发布序号</th>
              <th>发布时间</th>
              <th>版本状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {releases.map((item) => {
              const key = `${item.chartId}-v${item.version}`
              return (
                <tr key={key}>
                  <td>{item.code}</td>
                  <td>{item.displayName}</td>
                  <td>v{item.version}</td>
                  <td>{formatTime(item.publishedAt)}</td>
                  <td>{item.state === 'current' ? '当前版本' : '历史版本'}</td>
                  <td>
                    <button
                      className="link"
                      type="button"
                      onClick={() => setDetailKey((prev) => (prev === key ? null : key))}
                    >
                      详情
                    </button>
                  </td>
                </tr>
              )
            })}
            {releases.length === 0 && (
              <tr>
                <td className="empty-state" colSpan={6}>暂无发布版本，发布图表后在此查看当前与历史版本</td>
              </tr>
            )}
          </tbody>
        </table>

        {detailRelease && detailDiff && (
          <div className="release-detail">
            <h4 className="form-title">
              {detailRelease.code} 发布序号 v{detailRelease.version} 发布差异
            </h4>
            {!detailDiff.hasPrevious && (
              <p className="page-desc">首个发布版本，无历史版本可对比。</p>
            )}
            <table className="data-table">
              <thead>
                <tr>
                  <th>字段</th>
                  <th>上一版本</th>
                  <th>本版本</th>
                </tr>
              </thead>
              <tbody>
                {detailDiff.diffs.map((diff) => (
                  <tr key={diff.field} className={diff.changed ? 'diff-changed' : ''}>
                    <td>{diff.field}</td>
                    <td className={diff.changed ? 'diff-old' : ''}>{diff.before || '—'}</td>
                    <td className={diff.changed ? 'diff-new' : ''}>{diff.after || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="page-foot">
        <span>共 {total} 条可视化图表记录</span>
        {notice && <span className="notice-text">{notice}</span>}
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>
    </section>
  )
}
