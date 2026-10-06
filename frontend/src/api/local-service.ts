import {
  COOLING_KEY,
  coolingCounts,
  emptyFilters,
  exportCooling,
  FLOOD_KEY,
  floodPendingCount,
  floodTodoId,
  pushFloodTodo,
  queryCooling,
  upsertCoolingSystem,
  type CoolingDraft,
  type CoolingFilters,
  type CoolingQuery,
} from '@/api/cooling-domain'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
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
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

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

// ---------------------------------------------------------------------------
// 技术供水：收窄条件 / 排布 / 分页 / 去重登记 / 泄洪待办 / 按条件另存
// ---------------------------------------------------------------------------

/** 往后翻与跨模块返回时保持原条件、停在原页：查询状态由页面放进 pinia 会话。 */
export function listCooling(query: CoolingQuery): PageResult & { pageCount: number } {
  return queryCooling(listRows(COOLING_KEY), query)
}

export function coolingOverviewCounts(filters: CoolingFilters = emptyFilters()) {
  return coolingCounts(listRows(COOLING_KEY), filters)
}

export function saveCoolingSystem(draft: CoolingDraft): ActionResult {
  const { rows, result } = upsertCoolingSystem(listRows(COOLING_KEY), draft)
  if (result.ok) saveRows(COOLING_KEY, rows)
  return result
}

/** 处理结果落到泄洪操作待办；按系统编号幂等，重复提交只生效一次。 */
export function createFloodTodoFromCooling(id: number, operator?: string): ActionResult {
  const source = listRows(COOLING_KEY).find((row) => Number(row.id) === id)
  if (!source) {
    return { ok: false, message: '没有找到对应的技术供水系统' }
  }
  const { rows, result } = pushFloodTodo(listRows(FLOOD_KEY), source, operator)
  if (result.ok) saveRows(FLOOD_KEY, rows)
  return result
}

export function isFloodTodoExists(systemCode: string): boolean {
  return listRows(FLOOD_KEY).some(
    (row) => String(row['操作编号']) === floodTodoId(systemCode) || String(row['联动来源']) === systemCode,
  )
}

export function exportCoolingEntries(query: CoolingQuery) {
  return exportCooling(listRows(COOLING_KEY), query)
}

export function downloadCoolingEntries(query: CoolingQuery): number {
  const { filename, content, count } = exportCoolingEntries(query)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  return count
}

// ---------------------------------------------------------------------------
// 运营概览：技术供水行的异常量跟着收窄条件走，与列表始终对得上。
// ---------------------------------------------------------------------------

export function loadOverview(coolingFilters?: CoolingFilters): OverviewResult {
  const rows = allRows()
  const scoped = coolingOverviewCounts(coolingFilters ?? emptyFilters())
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    if (meta.key === COOLING_KEY) {
      // 与列表同源：收窄后是几台，概览里就是几台。
      return {
        name: meta.name,
        key: meta.key,
        created: scoped.total,
        pending: scoped.pending,
        abnormal: scoped.abnormal,
        scoped: hasCoolingScope(coolingFilters),
      }
    }
    return {
      name: meta.name,
      key: meta.key,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    // 待处理：各模块待办合计（泄洪模块的 pending 已含技术供水联动落入的待审批单）。
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
function hasCoolingScope(filters?: CoolingFilters): boolean {
  if (!filters) return false
  return Boolean(filters.keyword.trim() || filters.systemType || filters.pressureMin || filters.pressureMax)
}
