import { migrateCoolingRows } from '@/api/cooling-domain'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydropower-plant-om:entries'
const COOLING_KEY = 'cooling'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 存量迁移：技术供水按检查日期（登记时间）迁移到统一口径。
 * 以系统编号为幂等键，重复执行不会多出记录；缺项在领域层标注来源。
 */
function migrate(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  if (Array.isArray(data[COOLING_KEY])) {
    data[COOLING_KEY] = migrateCoolingRows(data[COOLING_KEY])
  }
  return data
}

function seedData(): Record<string, EntryRow[]> {
  return migrate(clone(SEED_ROWS))
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = seedData()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return migrate({ ...fallback, ...parsed })
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  const migrated = key === COOLING_KEY ? migrateCoolingRows(rows) : rows
  saveRows(key, migrated)
  return migrated
}

export function storageKey(): string {
  return STORAGE_KEY
}
