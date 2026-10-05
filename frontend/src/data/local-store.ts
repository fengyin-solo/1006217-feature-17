import { isLegacyCoolingRows, migrateCooling } from './cooling-migration'
import { LEGACY_COOLING } from './legacy-cooling'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydropower-plant-om:entries'
// 数据版本：v1 是初始化骨架的占位数据；v2 起技术供水按存量清单迁移口径管理。
const VERSION_KEY = 'hydropower-plant-om:version'
const CURRENT_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 技术供水迁移：本地若是 v1 占位数据（压力是非数值文本），用存量清单迁移；
// 一旦是规范数据（已迁移或用户已登记新系统），原样保留，迁移只发生一次、不留中间态。
function migrateIfNeeded(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  if (data.cooling && isLegacyCoolingRows(data.cooling)) {
    return { ...data, cooling: clone(migrateCooling(LEGACY_COOLING)) }
  }
  return data
}

function persist(data: Record<string, EntryRow[]>, version: number): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    window.localStorage.setItem(VERSION_KEY, String(version))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback, CURRENT_VERSION)
    return fallback
  }
  try {
    const parsed = migrateIfNeeded(JSON.parse(raw) as Record<string, EntryRow[]>)
    const merged = { ...fallback, ...parsed }
    persist(merged, CURRENT_VERSION)
    return merged
  } catch {
    persist(fallback, CURRENT_VERSION)
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
    window.localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
