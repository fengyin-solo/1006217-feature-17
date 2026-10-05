import { listRows, saveRows } from '../data/local-store'
import { bandOfPressure, PRESSURE_BANDS, toNumber } from '../data/cooling-migration'
import { COOLING_PAGE_SIZE } from '../stores/cooling'
import type {
  ActionResult,
  CoolingPageResult,
  CoolingQuery,
  EntryRow,
} from '../data/types'

// 技术供水统一查询管线。
// 同一条管线同时供列表、概览异常数、导出使用：
// 收窄后三台异常，概览里就一定是三台，另存出来的条数也和页面一致。
export function filterCoolingRows(rows: EntryRow[], query: CoolingQuery): EntryRow[] {
  const systemNo = query.systemNo.trim()
  const supplyType = query.supplyType
  const band = PRESSURE_BANDS.find((item) => item.value === query.pressureBand)
  return rows.filter((row) => {
    if (systemNo && !String(row['系统编号'] ?? '').includes(systemNo)) {
      return false
    }
    if (supplyType && String(row['供水类型'] ?? '') !== supplyType) {
      return false
    }
    if (band) {
      const pressure = toNumber(row['供水压力'] as string)
      if (pressure === null || pressure < band.min || pressure >= band.max) {
        return false
      }
    }
    return true
  })
}

function numericOf(row: EntryRow, field: string): number {
  return toNumber(row[field] as string) ?? Number.POSITIVE_INFINITY
}

// 排布先后也只读统一后的「供水压力」，与压力区间筛选同一套取值。
export function sortCoolingRows(rows: EntryRow[], sort: CoolingQuery['sort']): EntryRow[] {
  const copy = [...rows]
  switch (sort) {
    case 'pressureAsc':
      return copy.sort((a, b) => numericOf(a, '供水压力') - numericOf(b, '供水压力'))
    case 'pressureDesc':
      return copy.sort((a, b) => numericOf(b, '供水压力') - numericOf(a, '供水压力'))
    case 'filterDiffAsc':
      return copy.sort((a, b) => numericOf(a, '滤水器压差') - numericOf(b, '滤水器压差'))
    case 'filterDiffDesc':
      return copy.sort((a, b) => numericOf(b, '滤水器压差') - numericOf(a, '滤水器压差'))
    default:
      return copy.sort((a, b) => Number(a.id) - Number(b.id))
  }
}

export function queryCooling(query: CoolingQuery): CoolingPageResult {
  const matched = sortCoolingRows(filterCoolingRows(listRows('cooling'), query), query.sort)
  const total = matched.length
  const pages = Math.max(1, Math.ceil(total / COOLING_PAGE_SIZE))
  const page = Math.min(Math.max(1, query.page), pages)
  const start = (page - 1) * COOLING_PAGE_SIZE
  return {
    items: matched.slice(start, start + COOLING_PAGE_SIZE),
    total,
    page,
    size: COOLING_PAGE_SIZE,
    pages,
  }
}

// 概览用：收窄条件下的各类计数，和列表页 stat 卡片、另存结果完全同源。
export function coolingCounts(query: CoolingQuery): {
  total: number
  running: number
  abnormal: number
  pending: number
} {
  const matched = filterCoolingRows(listRows('cooling'), query)
  return {
    total: matched.length,
    running: matched.filter((row) => String(row.status) === '运行中').length,
    abnormal: matched.filter((row) => row.abnormal).length,
    pending: matched.filter((row) => row.pending).length,
  }
}

export type CoolingDraft = {
  systemNo: string
  supplyType: string
  pressure: string
  flow: string
  waterTemp: string
  filterDiff: string
  checkedAt: string
}

export function validateCoolingDraft(draft: CoolingDraft): string {
  if (!draft.systemNo.trim()) {
    return '系统编号不能为空'
  }
  if (!draft.supplyType) {
    return '请选择供水类型'
  }
  if (toNumber(draft.pressure) === null) {
    return '供水压力必须是数值，统一口径只保留一套实测量级压力（MPa）'
  }
  if (!draft.checkedAt) {
    return '请填写检查日期'
  }
  return ''
}

// 登记/更新：按系统编号去重——已存在就整行覆盖（同一覆盖版不留中间态），
// 不存在才新增。重复提交（同一编号连点两次）天然只生效一次。
export function upsertCooling(draft: CoolingDraft): ActionResult {
  const error = validateCoolingDraft(draft)
  if (error) {
    return { ok: false, message: error }
  }
  const rows = listRows('cooling')
  const today = new Date().toISOString().slice(0, 10)
  const pressure = toNumber(draft.pressure) as number
  const base: EntryRow = {
    id: 0,
    status: '待检查',
    pending: true,
    abnormal: false,
    系统编号: draft.systemNo.trim(),
    供水类型: draft.supplyType,
    供水压力: String(Math.round(pressure * 100) / 100),
    供水流量: String(toNumber(draft.flow) ?? ''),
    水温数值: String(toNumber(draft.waterTemp) ?? ''),
    滤水器压差: String(toNumber(draft.filterDiff) ?? ''),
    检查日期: draft.checkedAt,
    取值来源: '运行实测（值班登记）',
    登记时间: today,
    备注: '',
    系统状态: '待检查',
  }
  const index = rows.findIndex((row) => String(row['系统编号']) === base['系统编号'])
  if (index >= 0) {
    // 覆盖更新：保留原 id 与状态轨迹，业务字段整行替换为本次提交的版本。
    const previous = rows[index]
    const covered: EntryRow = {
      ...base,
      id: previous.id,
      status: previous.status,
      pending: previous.pending,
      abnormal: previous.abnormal,
      系统状态: previous.status,
      备注: `${today} 值班登记覆盖更新，以本次提交为唯一版本（来源：值班登记）`,
    }
    const next = [...rows]
    next[index] = covered
    saveRows('cooling', next)
    return { ok: true, message: `系统 ${covered['系统编号']} 已按本次提交覆盖，不保留旧版本` }
  }
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const created: EntryRow = { ...base, id: nextId }
  saveRows('cooling', [...rows, created])
  return { ok: true, message: `系统 ${created['系统编号']} 登记完成` }
}

// 跨模块：技术供水处理结果落到泄洪操作的待办清单。
// 同一供水系统只落一条（按系统编号幂等），重复点击只生效一次。
export function pushFloodTodo(systemRow: EntryRow, operator: string): ActionResult {
  const systemNo = String(systemRow['系统编号'] ?? '')
  const floodRows = listRows('flood')
  const todoText = `跟进技术供水 ${systemNo} 供水异常处理`
  const exists = floodRows.some((row) => String(row['待办事项'] ?? '').includes(systemNo))
  if (exists) {
    return { ok: false, message: `${systemNo} 的泄洪待办已存在，不重复登记` }
  }
  const nextId = floodRows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const today = new Date().toISOString().slice(0, 10)
  const todo: EntryRow = {
    id: nextId,
    status: '待审批',
    pending: true,
    abnormal: false,
    操作编号: `FLOO-${String(nextId).padStart(4, '0')}`,
    泄洪闸号: '—',
    开启孔数: '0',
    泄洪流量: '0',
    下游预警: '待评估',
    操作时间: today,
    操作人员: operator,
    待办事项: todoText,
    操作状态: '待审批',
  }
  saveRows('flood', [...floodRows, todo])
  return { ok: true, message: `${systemNo} 的处理结果已落入泄洪操作待办清单` }
}

// 技术供水动作收尾：标记异常必须让 abnormal 置真，概览/列表条数才对得上；
// 提交检查（恢复）与停运则解除异常标记。所有写操作一次 saveRows 落盘，不留中间态。
export function applyCoolingActionResult(row: EntryRow, action: string, target: string): EntryRow {
  const lastStatus = '已停运'
  if (action === '标记异常') {
    return { ...row, status: target, pending: target !== lastStatus, abnormal: true }
  }
  return { ...row, status: target, pending: target !== lastStatus, abnormal: false }
}

// 供页面压力区间徽标使用。
export function pressureBandLabel(pressure: string): string {
  const value = toNumber(pressure)
  if (value === null) {
    return '取值缺失'
  }
  return PRESSURE_BANDS.find((item) => item.value === bandOfPressure(value))?.label ?? ''
}
