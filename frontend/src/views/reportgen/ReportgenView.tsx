import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  countByStatus,
  createEntry,
  downloadEntries,
  listEntries,
  listStats,
  moduleMeta,
  publishedChartOptions,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, StatItem } from '@/data/types'

const meta = moduleMeta('reportgen')
const columns = [
  "模板编号",
  "模板名称",
  "包含图表",
  "报告周期",
  "导出格式",
  "推送渠道",
  "水印开关",
  "附件压缩"
]
const actions = [
  "提交审核",
  "生效发布",
  "停用模板"
]
const statuses = [
  "草稿",
  "待审核",
  "已生效",
  "已停用"
]
// 除「包含图表」外的登记表单字段，包含图表用已发布版本选择器勾选
const textFields = ["模板名称", "报告周期", "导出格式", "推送渠道", "水印开关", "附件压缩"]

export default function ReportgenView() {
  const [rows, setRows] = useState<EntryRow[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<StatItem[]>(() => listStats(meta.key))
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>(() => countByStatus(meta.key))
  const [chartOptions, setChartOptions] = useState<{ value: string; label: string }[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [selectedCharts, setSelectedCharts] = useState<string[]>([])
  const filterFields = useMemo(() => columns.slice(0, 3), [])

  const reload = useCallback(() => {
    setErrorMessage('')
    try {
      const payload = listEntries(meta.key, filters)
      setRows(payload.items)
      setTotal(payload.total)
      setStats(listStats(meta.key))
      setStatusCounts(countByStatus(meta.key))
      // 选择器与计数读同一份持久化数据，刷新后仍指向同一发布版本
      setChartOptions(publishedChartOptions())
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '报告生成列表读取失败')
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
    setCreating(true)
    setForm(Object.fromEntries(textFields.map((field) => [field, ''])))
    setSelectedCharts([])
    setErrorMessage('')
    setNotice('')
  }

  function toggleChart(value: string) {
    setSelectedCharts((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
    )
  }

  function saveForm() {
    setErrorMessage('')
    setNotice('')
    const result = createEntry(meta.key, { ...form, 包含图表: selectedCharts.join('、') })
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    setNotice(result.message)
    setCreating(false)
    reload()
  }

  return (
    <section className="page" data-module="reportgen">
      <header className="page-head">
        <div>
          <h2>报告生成管理</h2>
          <p className="page-desc">维护分析报告模板的输入、执行约束与结果记录，为报告生成提供可验证的数据工程流程。</p>
        </div>
        <div className="page-actions">
          <button className="btn primary" type="button" onClick={openCreate}>
            登记报告模板
          </button>
          <button className="btn" type="button" onClick={() => downloadEntries(meta.key)}>
            导出报告生成清单
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

      {creating && (
        <div className="form-panel">
          <h3 className="form-title">登记报告模板</h3>
          <div className="form-grid">
            {textFields.map((field) => (
              <label key={field} className="form-item">
                <span>{field}</span>
                <input
                  value={form[field] ?? ''}
                  placeholder={`请输入${field}`}
                  onChange={(event) => setForm((prev) => ({ ...prev, [field]: event.target.value }))}
                />
              </label>
            ))}
          </div>
          <div className="chart-picker">
            <span className="chart-picker-label">包含图表（当前已发布版本，共 {chartOptions.length} 个可选）</span>
            {chartOptions.length === 0 && (
              <p className="page-desc">暂无已发布图表版本可引用，请先在可视化图表页发布图表。</p>
            )}
            <div className="checkbox-list">
              {chartOptions.map((option) => (
                <label key={option.value} className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={selectedCharts.includes(option.value)}
                    onChange={() => toggleChart(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="form-actions">
            <button className="btn primary" type="button" onClick={saveForm}>保存</button>
            <button className="btn ghost" type="button" onClick={() => setCreating(false)}>取消</button>
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
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={columns.length + 2}>暂无报告生成数据，可先登记报告模板</td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="page-foot">
        <span>共 {total} 条报告生成记录</span>
        {notice && <span className="notice-text">{notice}</span>}
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>
    </section>
  )
}
