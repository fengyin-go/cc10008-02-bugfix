import { SEED_ROWS } from './seed'
import type { ChartRelease, EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 存储结构是 { rev, entries, releases }：rev 是整份数据的版本号，另一个页面（标签页）
// 先写入后，本页再保存会报冲突并提示先刷新，避免旧版本数据回写覆盖新内容。
const STORAGE_KEY = 'interactive-analytics-lab:entries'

export class StorageConflictError extends Error {
  constructor() {
    super('本地数据已被其他页面更新，请先刷新页面读取最新版本后再操作')
    this.name = 'StorageConflictError'
  }
}

type PersistedState = {
  rev: number
  entries: Record<string, EntryRow[]>
  releases: ChartRelease[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowIso(): string {
  return new Date().toISOString()
}

function chartSnapshot(row: EntryRow): Record<string, string | number | boolean> {
  const snapshot: Record<string, string | number | boolean> = {}
  for (const [field, value] of Object.entries(row)) {
    if (field === 'id' || field === 'status' || field === 'pending' || field === 'abnormal') {
      continue
    }
    snapshot[field] = value
  }
  return snapshot
}

function nextChartVersion(releases: ChartRelease[], chartId: number): number {
  let max = 0
  for (const release of releases) {
    if (release.chartId === chartId) {
      max = Math.max(max, release.version)
    }
  }
  return max + 1
}

// 让发布版本与图表配置对齐：已发布但缺当前版本的补登一条；配置已下线或删除的当前版本转历史。
// 返回是否有改动。调用方保证传入的 state 是可变的本地副本。
function reconcileReleases(state: PersistedState): boolean {
  const charts = state.entries['chart'] ?? []
  let changed = false
  for (const release of state.releases) {
    if (release.state !== 'current') {
      continue
    }
    const row = charts.find((item) => Number(item.id) === release.chartId)
    if (!row || row.status !== '已发布') {
      release.state = 'history'
      release.offlineAt = release.offlineAt ?? nowIso()
      changed = true
    }
  }
  for (const row of charts) {
    if (row.status !== '已发布') {
      continue
    }
    const chartId = Number(row.id)
    const hasCurrent = state.releases.some((item) => item.chartId === chartId && item.state === 'current')
    if (!hasCurrent) {
      state.releases.push({
        chartId,
        version: nextChartVersion(state.releases, chartId),
        name: String(row['图表名称'] ?? ''),
        snapshot: chartSnapshot(row),
        publishedAt: nowIso(),
        state: 'current',
      })
      changed = true
    }
  }
  return changed
}

function seedState(): PersistedState {
  return { rev: 0, entries: clone(SEED_ROWS), releases: [] }
}

function normalize(parsed: unknown): PersistedState {
  // 兼容旧格式：早期直接存 { 模块: 行数组 }，没有 rev 和发布版本，按 rev 0 迁移。
  if (parsed && typeof parsed === 'object' && 'entries' in parsed && 'rev' in parsed) {
    const shaped = parsed as Partial<PersistedState>
    return {
      rev: Number(shaped.rev) || 0,
      entries: (shaped.entries ?? {}) as Record<string, EntryRow[]>,
      releases: Array.isArray(shaped.releases) ? (shaped.releases as ChartRelease[]) : [],
    }
  }
  return { rev: 0, entries: (parsed ?? {}) as Record<string, EntryRow[]>, releases: [] }
}

function writeStorage(state: PersistedState): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

function readStorage(): PersistedState {
  if (typeof window === 'undefined' || !window.localStorage) {
    const state = seedState()
    reconcileReleases(state)
    return state
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  let state: PersistedState
  if (!raw) {
    state = seedState()
  } else {
    try {
      state = normalize(JSON.parse(raw))
    } catch {
      state = seedState()
    }
  }
  // 后登记的模块没有历史数据时用示例数据补上
  state.entries = { ...clone(SEED_ROWS), ...state.entries }
  const changed = reconcileReleases(state)
  if (!raw || changed) {
    state.rev += 1
    writeStorage(state)
  }
  return state
}

function storedRev(): number {
  if (typeof window === 'undefined' || !window.localStorage) {
    return cache?.rev ?? 0
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return 0
  }
  try {
    return normalize(JSON.parse(raw)).rev
  } catch {
    return 0
  }
}

let cache: PersistedState | null = null

function allState(): PersistedState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

// 落库前校验 rev：别的页面已经写过就说明本页数据是旧的，拒绝回写，让页面先刷新。
function persist(state: PersistedState): void {
  const baseRev = cache ? cache.rev : storedRev()
  if (storedRev() !== baseRev) {
    throw new StorageConflictError()
  }
  const next = { ...state, rev: baseRev + 1 }
  cache = next
  writeStorage(next)
}

export function allRows(): Record<string, EntryRow[]> {
  return allState().entries
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function allReleases(): ChartRelease[] {
  return allState().releases
}

export function saveState(key: string, rows: EntryRow[], releases?: ChartRelease[]): void {
  const base = allState()
  persist({
    ...base,
    entries: { ...base.entries, [key]: rows },
    releases: releases ?? base.releases,
  })
}

export function saveRows(key: string, rows: EntryRow[]): void {
  saveState(key, rows)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  const base = allState()
  const next: PersistedState = {
    ...base,
    entries: { ...base.entries, [key]: rows },
    releases: clone(base.releases),
  }
  if (key === 'chart') {
    reconcileReleases(next)
  }
  persist(next)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
