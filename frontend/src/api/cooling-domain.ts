import type { ActionResult, CoolingFilters, CoolingQuery, CoolingSort, EntryRow } from '@/data/types'

export type { CoolingFilters, CoolingQuery, CoolingSort }

/**
 * 技术供水领域规则（只有这一套，筛选与排序共用，全模块不再各写一遍）：
 *
 * 1. 两套取值：每个系统可能同时存在「登记值」与「运行实测值（带实测时间）」。
 *    统一规则——以较晚产生的那一套为准（实测时间晚于检查日期取实测，否则取登记；
 *    时间相同视为实测更晚）。保存/迁移时就把生效值回写到供水压力、滤水器压差，
 *    并在「取值来源」标注来源。所以压力区间收窄与按压力/压差排布用的是同一个值，
 *    不会出现找的时候一套、排的时候另一套。
 * 2. 存量归类：检查日期早于 LEGACY_DATE 且没有供水类型的，统一归为
 *    「机组冷却水（历史遗留）」，备注标注回填来源；已有类型的原样保留。
 * 3. 去重：按系统编号唯一，重复登记只保留一条；存量迁移也按系统编号去重，
 *    同编号多条时保留检查日期较晚、且取值更完整的一条。
 * 4. 异常事实源：以系统状态 === 异常 为准（abnormal 仅作冗余标记，迁移时一并校正）。
 */

export const COOLING_KEY = 'cooling'
export const FLOOD_KEY = 'flood'

/** 存量清单的分界：早于此检查日期且缺供水类型的，按历史遗留规则归类。 */
export const LEGACY_DATE = '2026-09-01'
export const LEGACY_TYPE = '机组冷却水（历史遗留）'

/** 供水类型收窄项（其余类型也能登记，下拉只是常用收窄口径）。 */
export const WATER_TYPES = ['机组冷却水', '主变冷却水', '消防供水', '技术检修供水', LEGACY_TYPE]

/** 登记可选项：历史遗留类型只由存量回填产生，不允许手工选给新系统。 */
export const CREATE_TYPES = WATER_TYPES.filter((t) => t !== LEGACY_TYPE)

export const PRESSURE_SOURCE = { registered: '登记值', measured: '运行实测值', backfilled: '存量回填' } as const

/** 存量缺项的安全回填（不参与异常判定，仅保证可筛选、可排序）。 */
export const BACKFILL_PRESSURE = 0.3
export const BACKFILL_DIFF = 0.04

/** 压力区间收窄口径（MPa）：采用半开区间 [min, max)，三个区间不重不漏。 */
export const PRESSURE_RANGES = [
  { label: '全部', min: '', max: '' },
  { label: '低压（< 0.30 MPa）', min: '', max: '0.30' },
  { label: '正常（0.30–0.60 MPa）', min: '0.30', max: '0.60' },
  { label: '高压（≥ 0.60 MPa）', min: '0.60', max: '' },
] as const

export const DEFAULT_PAGE_SIZE = 8

type Num = number | null

export function toNum(value: unknown): Num {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const parsed = Number.parseFloat(String(value).replace(/[^\d.\-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

/** 取值来源标签：回写在行上，列表与导出都认它。 */
export type EffectiveSource = '登记值' | '运行实测值' | '存量回填'

export type Effective = {
  pressure: Num
  diff: Num
  source: EffectiveSource
  registeredAt: string
  measuredAt: string
  pressureBackfilled: boolean
  diffBackfilled: boolean
}

/**
 * 两套取值统一到一套：较晚产生的那套整体生效（压力、压差同进退，不混用两套）。
 */
export function resolveEffective(input: {
  pressureReg: unknown
  pressureRun: unknown
  diffReg: unknown
  diffRun: unknown
  checkDate: string
  measuredAt: string
}): Effective {
  const checkDate = input.checkDate
  const measuredAt = input.measuredAt
  const hasRun = measuredAt !== ''
  // 同日视为实测更晚（实测是后来补测的）。
  const runWins = hasRun && measuredAt >= checkDate
  const source: EffectiveSource = runWins ? PRESSURE_SOURCE.measured : PRESSURE_SOURCE.registered

  let pressure = toNum(runWins ? input.pressureRun : input.pressureReg)
  let diff = toNum(runWins ? input.diffRun : input.diffReg)

  const pressureBackfilled = pressure === null
  const diffBackfilled = diff === null
  const effectiveSource: EffectiveSource = pressureBackfilled && diffBackfilled ? PRESSURE_SOURCE.backfilled : source
  if (pressure === null) pressure = BACKFILL_PRESSURE
  if (diff === null) diff = BACKFILL_DIFF

  return {
    pressure,
    diff,
    source: effectiveSource,
    registeredAt: checkDate,
    measuredAt,
    pressureBackfilled,
    diffBackfilled,
  }
}

/** 数值字段缺项时的备注（导出与页面都能看到来源说明）。 */
function backfillNote(eff: Effective): string {
  const notes: string[] = []
  if (eff.pressureBackfilled) notes.push('供水压力缺项，按存量安全值 0.30 MPa 回填')
  if (eff.diffBackfilled) notes.push('滤水器压差缺项，按存量安全值 0.04 MPa 回填')
  return notes.join('；')
}

function normalizeCooling(raw: EntryRow): EntryRow {
  const status0 = asText(raw['系统状态']) || asText(raw.status)
  const sourceTag = asText(raw['取值来源'])
  // 已经是统一形态的行：幂等返回，只校正状态标记与数值类型，不把生效值误判成缺项再回填。
  if (sourceTag === PRESSURE_SOURCE.registered || sourceTag === PRESSURE_SOURCE.measured || sourceTag === PRESSURE_SOURCE.backfilled) {
    return {
      ...raw,
      id: Number(raw.id),
      status: status0,
      pending: status0 !== '已停运',
      abnormal: status0 === '异常',
      供水压力: toNum(raw['供水压力']) ?? BACKFILL_PRESSURE,
      供水流量: toNum(raw['供水流量']) ?? 0,
      水温数值: toNum(raw['水温数值']) ?? 0,
      滤水器压差: toNum(raw['滤水器压差']) ?? BACKFILL_DIFF,
      供水类型: asText(raw['供水类型']) || LEGACY_TYPE,
      系统状态: status0,
      备注: asText(raw['备注']),
    }
  }

  const checkDate = asText(raw['检查日期'])
  const measuredAt = asText(raw['运行实测时间'])
  const eff = resolveEffective({
    pressureReg: raw['供水压力登记值'],
    pressureRun: raw['供水压力实测值'],
    diffReg: raw['滤水器压差登记值'],
    diffRun: raw['滤水器压差实测值'],
    checkDate,
    measuredAt,
  })

  // 存量系统：早期没有供水类型的，按检查日期统一归类。
  let type = asText(raw['供水类型'])
  let typeBackfilled = false
  if (!type) {
    type = LEGACY_TYPE
    typeBackfilled = true
  }

  const noteParts = [asText(raw['备注'])]
  if (typeBackfilled) noteParts.push(`供水类型缺项，按检查日期 ${checkDate || '—'} 归为「${LEGACY_TYPE}」（存量回填）`)
  const valueNote = backfillNote(eff)
  if (valueNote) noteParts.push(valueNote)
  if (measuredAt) noteParts.push(`运行实测时间 ${measuredAt}`)
  const 备注 = noteParts.filter(Boolean).join('；')

  const status = asText(raw['系统状态']) || asText(raw.status)
  return {
    id: Number(raw.id),
    status,
    pending: status !== '已停运',
    abnormal: status === '异常',
    系统编号: asText(raw['系统编号']),
    供水类型: type,
    供水压力: eff.pressure as number,
    供水流量: toNum(raw['供水流量']) ?? 0,
    水温数值: toNum(raw['水温数值']) ?? 0,
    滤水器压差: eff.diff as number,
    取值来源: eff.source,
    检查日期: checkDate,
    运行实测时间: measuredAt,
    系统状态: status,
    备注,
  }
}

/**
 * 存量清单迁移：按检查日期（登记时间）由早到晚迁移并重新编号；
 * 同系统编号重复登记只保留一条（检查日期晚、字段更完整的胜出）。
 * 已经是新形态的行原样走一遍归一化，保证幂等——重复执行不会多出记录。
 */
export function migrateCoolingRows(rows: EntryRow[]): EntryRow[] {
  const picked = new Map<string, EntryRow>()
  for (const row of rows) {
    const code = asText(row['系统编号'])
    if (!code) continue
    const prev = picked.get(code)
    if (!prev || isNewerOrRicher(row, prev)) {
      picked.set(code, row)
    }
  }
  const normalized = [...picked.values()].map(normalizeCooling)
  normalized.sort((a, b) => {
    const da = asText(a['检查日期'])
    const db = asText(b['检查日期'])
    if (da !== db) return da < db ? -1 : 1
    return asText(a['系统编号']) < asText(b['系统编号']) ? -1 : 1
  })
  return normalized.map((row, index) => ({ ...row, id: index + 1 }))
}

/** 同编号去重时的取舍：检查日期晚的胜；同日则取值/类型更完整的胜。 */
function isNewerOrRicher(candidate: EntryRow, current: EntryRow): boolean {
  const dc = asText(candidate['检查日期'])
  const dp = asText(current['检查日期'])
  if (dc !== dp) return dc > dp
  const score = (row: EntryRow) =>
    [row['供水类型'], row['供水压力登记值'] ?? row['供水压力'], row['供水压力实测值'], row['滤水器压差登记值'] ?? row['滤水器压差'], row['供水流量']]
      .filter((v) => asText(v) !== '').length
  return score(candidate) > score(current)
}

export function emptyFilters(): CoolingFilters {
  return { keyword: '', systemType: '', pressureMin: '', pressureMax: '' }
}

function inRange(value: number, min: Num, max: Num): boolean {
  // 半开区间 [min, max)：上限不含，保证三档区间不重不漏。
  if (min !== null && value < min) return false
  if (max !== null && value >= max) return false
  return true
}

export function filterCooling(rows: EntryRow[], filters: CoolingFilters): EntryRow[] {
  const keyword = filters.keyword.trim()
  const type = filters.systemType
  const min = toNum(filters.pressureMin)
  const max = toNum(filters.pressureMax)
  return rows.filter((row) => {
    if (keyword && !asText(row['系统编号']).includes(keyword)) return false
    if (type && asText(row['供水类型']) !== type) return false
    // 压力区间按生效实测口径取（与排序同一个值）。
    if ((min !== null || max !== null) && !inRange(toNum(row['供水压力']) ?? NaN, min, max)) return false
    return true
  })
}

export function sortCooling(
  rows: EntryRow[],
  sort: CoolingQuery['sort'],
): EntryRow[] {
  const copy = [...rows]
  const dir = sort.order === 'asc' ? 1 : -1
  copy.sort((a, b) => {
    let cmp: number
    if (sort.field === '系统编号') {
      cmp = asText(a['系统编号']).localeCompare(asText(b['系统编号']), 'zh-Hans-CN')
    } else {
      const na = toNum(a[sort.field])
      const nb = toNum(b[sort.field])
      // 回填缺项不参与排布时排到最后，避免缺项抢占前列。
      if (na === null && nb === null) cmp = 0
      else if (na === null) cmp = 1
      else if (nb === null) cmp = -1
      else cmp = na - nb
    }
    if (cmp !== 0) return cmp * dir
    return asText(a['系统编号']).localeCompare(asText(b['系统编号']), 'zh-Hans-CN')
  })
  return copy
}

/** 条件收窄 + 排布 + 分页：返回的 items 就是当页要停住的那一批。 */
export function queryCooling(rows: EntryRow[], query: CoolingQuery) {
  const matched = sortCooling(filterCooling(rows, query.filters), query.sort)
  const size = query.size > 0 ? query.size : DEFAULT_PAGE_SIZE
  const pageCount = Math.max(1, Math.ceil(matched.length / size))
  // 条件变化导致当前页超出范围时，停在最后一个有效页，而不是跳回第一页。
  const page = Math.min(Math.max(1, query.page), pageCount)
  const start = (page - 1) * size
  return {
    items: matched.slice(start, start + size),
    total: matched.length,
    page,
    size,
    pageCount,
  }
}

export type CoolingCounts = {
  total: number
  running: number
  abnormal: number
  pending: number
}

/**
 * 收窄后的统计：异常系统数与列表同源。
 * 冷却页统计卡与运营概览 cooling 行都调它，保证「列表三台、概览两台」不可能发生。
 */
export function coolingCounts(rows: EntryRow[], filters: CoolingFilters): CoolingCounts {
  const matched = filterCooling(rows, filters)
  return {
    total: matched.length,
    running: matched.filter((r) => asText(r['系统状态']) === '运行中').length,
    abnormal: matched.filter((r) => asText(r['系统状态']) === '异常').length,
    pending: matched.filter((r) => asText(r['系统状态']) === '待检查').length,
  }
}

export type CoolingDraft = {
  系统编号: string
  供水类型: string
  供水压力: string
  供水流量: string
  水温数值: string
  滤水器压差: string
  检查日期: string
  系统状态: string
  运行实测时间: string
  供水压力实测值: string
  滤水器压差实测值: string
}

/**
 * 登记/覆盖：按系统编号去重，同编号重复提交只生效一次——
 * 找到旧记录就整行覆盖为本次版本（覆盖的那一版不留中间态），找不到才新增。
 */
export function upsertCoolingSystem(
  rows: EntryRow[],
  draft: CoolingDraft,
): { rows: EntryRow[]; result: ActionResult; created: boolean } {
  const code = draft.系统编号.trim()
  if (!code) {
    return { rows, result: { ok: false, message: '系统编号不能为空' }, created: false }
  }
  const checkDate = draft.检查日期 || new Date().toISOString().slice(0, 10)
  const status = draft.系统状态 || '待检查'

  const base: EntryRow = {
    id: 0,
    status,
    pending: status !== '已停运',
    abnormal: status === '异常',
    系统编号: code,
    供水类型: draft.供水类型.trim() || LEGACY_TYPE,
    供水压力登记值: draft.供水压力,
    供水压力实测值: draft.运行实测时间 ? draft.供水压力实测值 : '',
    供水流量: draft.供水流量,
    水温数值: draft.水温数值,
    滤水器压差登记值: draft.滤水器压差,
    滤水器压差实测值: draft.运行实测时间 ? draft.滤水器压差实测值 : '',
    检查日期: checkDate,
    运行实测时间: draft.运行实测时间,
    系统状态: status,
  }

  const normalized = normalizeCooling(base)
  const index = rows.findIndex((r) => asText(r['系统编号']) === code)
  let nextRows: EntryRow[]
  let created: boolean
  if (index >= 0) {
    // 覆盖：保留原 id，整行替换，不产生中间态。
    nextRows = rows.map((r, i) => (i === index ? { ...normalized, id: r.id } : r))
    created = false
  } else {
    const nextId = rows.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1
    nextRows = [...rows, { ...normalized, id: nextId }]
    created = true
  }
  // 存量顺序保持检查日期有序。
  nextRows = [...nextRows].sort((a, b) => {
    const da = asText(a['检查日期'])
    const db = asText(b['检查日期'])
    return da === db ? 0 : da < db ? -1 : 1
  }).map((r, i) => ({ ...r, id: i + 1 }))

  return {
    rows: nextRows,
    created,
    result: {
      ok: true,
      message: created ? `供水系统 ${code} 已登记` : `供水系统 ${code} 已按本次提交覆盖，重复提交未新增记录`,
    },
  }
}

/** 泄洪待办的幂等键：同一系统编号永远只有一条。 */
export function floodTodoId(systemCode: string): string {
  return `FLOOD-COOL-${systemCode}`
}

/**
 * 处理结果落到泄洪操作的待办清单。
 * 同一系统重复推送只生效一次（已存在则原样返回），整表替换写入，不留中间态。
 */
export function pushFloodTodo(
  floodRows: EntryRow[],
  coolingRow: EntryRow,
  operator = '值班管理员',
): { rows: EntryRow[]; result: ActionResult } {
  const code = asText(coolingRow['系统编号'])
  const todoNo = floodTodoId(code)
  if (floodRows.some((r) => asText(r['操作编号']) === todoNo || asText(r['联动来源']) === code)) {
    return { rows: floodRows, result: { ok: false, message: `${code} 已在泄洪待办清单中，重复提交不生效` } }
  }
  const today = new Date().toISOString().slice(0, 10)
  const nextId = floodRows.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1
  const todo: EntryRow = {
    id: nextId,
    status: '待审批',
    pending: true,
    abnormal: false,
    操作编号: todoNo,
    泄洪闸号: `技术供水联动-${code}`,
    开启孔数: 0,
    泄洪流量: 0,
    下游预警: '待审批',
    操作时间: today,
    操作人员: operator,
    操作状态: '待审批',
    联动来源: code,
    待办说明: `技术供水系统异常处置：${code}（${asText(coolingRow['供水类型'])}，压力 ${toNum(coolingRow['供水压力'])} MPa，压差 ${toNum(coolingRow['滤水器压差'])} MPa）`,
  }
  return { rows: [...floodRows, todo], result: { ok: true, message: `${code} 已列入泄洪操作待办清单` } }
}

/** 泄洪模块跨模块计数：联动待办也算「待审批操作」，别处条数跟着一起变。 */
export function floodPendingCount(floodRows: EntryRow[]): number {
  return floodRows.filter((r) => asText(r['操作状态']) === '待审批' || asText(r.status) === '待审批').length
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * 另存结果：按当前收窄条件与排布顺序导出，条数与页面呈现（total）完全一致。
 */
export function exportCooling(
  rows: EntryRow[],
  query: CoolingQuery,
): { filename: string; content: string; count: number } {
  const matched = sortCooling(filterCooling(rows, query.filters), query.sort)
  const header = ['系统编号', '供水类型', '供水压力(MPa)', '供水流量(m³/h)', '水温(℃)', '滤水器压差(MPa)', '取值来源', '检查日期', '运行实测时间', '系统状态', '备注']
  const lines = [header.join(',')]
  for (const row of matched) {
    lines.push([
      row['系统编号'], row['供水类型'], row['供水压力'], row['供水流量'], row['水温数值'],
      row['滤水器压差'], row['取值来源'], row['检查日期'], row['运行实测时间'], row['系统状态'], row['备注'],
    ].map(csvCell).join(','))
  }
  return {
    filename: `技术供水清单-按条件${matched.length}条.csv`,
    content: `﻿${lines.join('\n')}`,
    count: matched.length,
  }
}
