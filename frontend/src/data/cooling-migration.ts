import type { EntryRow } from './types'

/**
 * 技术供水存量清单迁移（纯函数，便于校验）。
 *
 * 统一口径：每条存量记录可能同时带着两套压力取值——
 *   - ledgerPressure：台账/设计定值
 *   - measuredPressure：运行时段实测值
 * 两套并存且有争议时，以「较晚产生」的那一套为准（比较 ledgerAt / measuredAt），
 * 统一成唯一的「供水压力」，原两套取值不留中间态，并在「取值来源」注明采用了哪套。
 * 压力区间筛选与压力排序都只读统一后的「供水压力」，保证找的时候和排先后时用同一套。
 *
 * 存量回填：
 *   - 按「登记时间」迁移；没有登记时间的用「检查日期」回填，备注注明。
 *   - 早期没有「供水类型」的，以 2021-01-01 为界：检查/登记时间早于该日归
 *     「机组冷却供水」，之后归「公用技术供水」，备注注明回填依据。
 *   - 同一系统编号重复登记的不多出两条，按系统编号去重并保留较晚登记的一条。
 */

// 存量原始记录：两套取值并存，字段可能缺项。
export type LegacyCoolingRow = {
  id: number
  status: string
  abnormal: boolean
  systemNo: string
  supplyType: string
  ledgerPressure: number | string | null
  measuredPressure: number | string | null
  flow: number | string
  waterTemp: number | string
  filterDiff: number | string
  checkedAt: string
  registeredAt?: string
  ledgerAt?: string
  measuredAt?: string
}

export type CanonicalCoolingRow = EntryRow & {
  系统编号: string
  供水类型: string
  供水压力: string
  供水流量: string
  水温数值: string
  滤水器压差: string
  检查日期: string
  取值来源: string
  登记时间: string
  备注: string
  系统状态: string
}

// 早期供水类型回填的分界日：早于该日的早期系统按机组冷却供水归类。
export const SUPPLY_TYPE_CUTOFF = '2021-01-01'
export const TYPE_BACKFILL_EARLY = '机组冷却供水'
export const TYPE_BACKFILL_LATE = '公用技术供水'
export const SUPPLY_TYPES = ['机组冷却供水', '公用技术供水', '消防供水', '生态供水']

export const PRESSURE_BANDS = [
  { value: 'low', label: '低压 <0.20 MPa', min: -Infinity, max: 0.2 },
  { value: 'normal', label: '正常 0.20–0.35 MPa', min: 0.2, max: 0.35 },
  { value: 'high', label: '高压 >0.35 MPa', min: 0.35, max: Infinity },
]

export function bandOfPressure(value: number): string {
  if (value < 0.2) {
    return 'low'
  }
  if (value < 0.35) {
    return 'normal'
  }
  return 'high'
}

// “0.28 MPa” / 0.28 / “0,28” 这类存量写法统一取成数值；
// 纯文本（如占位数据“技术供水样例1”）不取数字，返回 null。
export function toNumber(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') {
    return null
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null
  }
  // 必须以数字或正负号开头，避免从“技术供水样例1”这类文本里误取末尾数字。
  const matched = raw.trim().replace(/,/g, '.').match(/^[+-]?\d+(\.\d+)?/)
  return matched ? Number(matched[0]) : null
}

function round2(value: number): string {
  return String(Math.round(value * 100) / 100)
}

// 判断 v1 种子里的占位数据（供水压力是“技术供水样例N”这类非数值文本）。
export function isLegacyPlaceHolderRow(row: EntryRow): boolean {
  return toNumber(row['供水压力'] as string) === null
}

export function isLegacyCoolingRows(rows: EntryRow[]): boolean {
  return rows.length > 0 && rows.every(isLegacyPlaceHolderRow)
}

type PressureDecision = {
  value: number
  source: string
  note: string
}

// 两套取值只认一套：谁晚产生谁说了算。只有一套时就用那一套。
export function resolvePressure(raw: LegacyCoolingRow): PressureDecision | null {
  const ledger = toNumber(raw.ledgerPressure)
  const measured = toNumber(raw.measuredPressure)
  const ledgerAt = raw.ledgerAt ?? ''
  const measuredAt = raw.measuredAt ?? ''

  if (ledger !== null && measured !== null) {
    const useLedger = ledgerAt > measuredAt
    return {
      value: useLedger ? ledger : measured,
      source: useLedger ? '台账定值（较晚产生，统一取值）' : '运行实测（较晚产生，统一取值）',
      note:
        `两套取值并存：台账 ${round2(ledger)} MPa（${ledgerAt || '无时间'}）、` +
        `实测 ${round2(measured)} MPa（${measuredAt || '无时间'}），已按较晚产生的一套统一`,
    }
  }
  if (ledger !== null) {
    return { value: ledger, source: '台账定值（仅有一套）', note: '缺运行实测值，沿用台账定值' }
  }
  if (measured !== null) {
    return {
      value: measured,
      source: '运行实测（仅有一套）',
      note: '缺台账定值，采用运行时段实测值',
    }
  }
  return null
}

function resolveSupplyType(raw: LegacyCoolingRow, registeredAt: string): { type: string; note: string } {
  const type = raw.supplyType.trim()
  if (type) {
    return { type, note: '' }
  }
  const base = registeredAt < SUPPLY_TYPE_CUTOFF ? TYPE_BACKFILL_EARLY : TYPE_BACKFILL_LATE
  return {
    type: base,
    note: `早期登记无供水类型，按${SUPPLY_TYPE_CUTOFF}分界回填为「${base}」（来源：存量迁移规则）`,
  }
}

function resolveRegisteredAt(raw: LegacyCoolingRow): { value: string; note: string } {
  if (raw.registeredAt) {
    return { value: raw.registeredAt, note: '' }
  }
  return { value: raw.checkedAt, note: '缺登记时间，按检查日期回填（来源：存量迁移规则）' }
}

/**
 * 存量迁移主流程：
 * 1. 按登记时间排序；
 * 2. 同一系统编号只保留较晚登记的一条（去重不留多余记录）；
 * 3. 两套压力取值按“较晚产生”仲裁为唯一供水压力；
 * 4. 缺供水类型、缺登记时间的按规则回填并标注来源。
 */
export function migrateCooling(legacy: LegacyCoolingRow[]): CanonicalCoolingRow[] {
  const ordered = [...legacy].sort((a, b) => {
    const aTime = a.registeredAt ?? a.checkedAt
    const bTime = b.registeredAt ?? b.checkedAt
    if (aTime !== bTime) {
      return aTime < bTime ? -1 : 1
    }
    return a.id - b.id
  })

  const latestByNo = new Map<string, LegacyCoolingRow>()
  for (const row of ordered) {
    latestByNo.set(row.systemNo, row)
  }

  // Map 保留首次插入位置，去重后必须再按登记时间排一次，重复系统才会落在正确位置。
  const deduped = [...latestByNo.values()].sort((a, b) => {
    const aTime = a.registeredAt ?? a.checkedAt
    const bTime = b.registeredAt ?? b.checkedAt
    if (aTime !== bTime) {
      return aTime < bTime ? -1 : 1
    }
    return a.id - b.id
  })

  const notesOf = (parts: string[]): string => parts.filter(Boolean).join('；')

  return deduped.map((raw, index) => {
    const registered = resolveRegisteredAt(raw)
    const supplyType = resolveSupplyType(raw, registered.value)
    const pressure = resolvePressure(raw)
    const notes: string[] = []
    if (registered.note) {
      notes.push(registered.note)
    }
    if (supplyType.note) {
      notes.push(supplyType.note)
    }
    if (pressure?.note) {
      notes.push(pressure.note)
    }
    if (!pressure) {
      notes.push('两套压力取值均缺失，供水压力留空待补录（来源：存量迁移规则）')
    }

    return {
      id: index + 1,
      status: raw.status,
      pending: raw.status !== '已停运',
      abnormal: raw.abnormal,
      系统编号: raw.systemNo,
      供水类型: supplyType.type,
      供水压力: pressure ? round2(pressure.value) : '',
      供水流量: toNumber(raw.flow) === null ? '' : round2(toNumber(raw.flow) as number),
      水温数值: toNumber(raw.waterTemp) === null ? '' : round2(toNumber(raw.waterTemp) as number),
      滤水器压差: toNumber(raw.filterDiff) === null ? '' : round3(toNumber(raw.filterDiff) as number),
      检查日期: raw.checkedAt,
      取值来源: pressure ? pressure.source : '缺失待补录',
      登记时间: registered.value,
      备注: notesOf(notes),
      系统状态: raw.status,
    }
  })
}

function round3(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}
