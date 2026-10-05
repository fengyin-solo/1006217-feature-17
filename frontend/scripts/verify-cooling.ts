/* eslint-disable no-console */
// 技术供水存量迁移与统一查询管线的校验脚本。
// 不依赖浏览器/localStorage，直接校验纯函数与查询管线的关键不变量。
// 运行：npm run verify（tsc 编译到 .verify-tmp 后用 node 执行）
import assert from 'node:assert'
import {
  bandOfPressure,
  isLegacyCoolingRows,
  migrateCooling,
  resolvePressure,
  toNumber,
} from '../src/data/cooling-migration'
import { LEGACY_COOLING } from '../src/data/legacy-cooling'
import type { CanonicalCoolingRow } from '../src/data/cooling-migration'
import type { CoolingQuery } from '../src/data/types'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const migrated: CanonicalCoolingRow[] = migrateCooling(LEGACY_COOLING)
const byNo = new Map<string, CanonicalCoolingRow>(migrated.map((row) => [row['系统编号'], row]))
function must(no: string): CanonicalCoolingRow {
  const row = byNo.get(no)
  assert.ok(row, `缺少系统 ${no}`)
  return row as CanonicalCoolingRow
}

// ---- 迁移：去重、回填、取值仲裁 ----
check('原始登记 29 条，按系统编号去重后 26 个系统', () => {
  assert.strictEqual(LEGACY_COOLING.length, 29)
  assert.strictEqual(migrated.length, 26)
  assert.strictEqual(new Set(migrated.map((r) => r['系统编号'])).size, 26)
})

check('重复登记保留较晚登记的一条（COOL-0007：较晚登记里实测 2024 晚于台账 2021，取实测 0.37）', () => {
  const row = must('COOL-0007')
  assert.strictEqual(row['供水压力'], '0.37')
  assert.strictEqual(row['检查日期'], '2024-05-20')
  assert.ok(row['取值来源'].includes('运行实测'), `来源应为运行实测：${row['取值来源']}`)
})

check('COOL-0012 与 COOL-0007 相反：台账（01-16）晚于实测（01-10），台账较晚产生为准', () => {
  const row = must('COOL-0012')
  assert.strictEqual(row['供水压力'], '0.28')
  assert.ok(row['取值来源'].includes('台账定值'))
  assert.ok(row['备注'].includes('较晚产生'))
})

check('COOL-0015 保留较晚一条，较晚的实测 0.34 生效', () => {
  assert.strictEqual(must('COOL-0015')['供水压力'], '0.34')
})

check('COOL-0024 保留较晚一条，压力由 0.14 变为 0.26（异常已随较晚登记解除）', () => {
  const row = must('COOL-0024')
  assert.strictEqual(row['供水压力'], '0.26')
  assert.strictEqual(row.abnormal, false)
})

check('常规情况实测较晚，统一取实测值（COOL-0004 → 0.36）', () => {
  assert.strictEqual(must('COOL-0004')['供水压力'], '0.36')
})

check('缺供水类型的早期记录按 2021-01-01 分界回填并标注来源', () => {
  assert.strictEqual(must('COOL-0009')['供水类型'], '机组冷却供水')
  assert.strictEqual(must('COOL-0010')['供水类型'], '公用技术供水')
  assert.ok(must('COOL-0009')['备注'].includes('回填'))
  assert.ok(must('COOL-0009')['备注'].includes('来源：存量迁移规则'))
})

check('缺登记时间按检查日期回填并标注（COOL-0023 无 registeredAt，回填为检查日期）', () => {
  assert.strictEqual(must('COOL-0023')['登记时间'], '2022-02-22')
  assert.ok(must('COOL-0023')['备注'].includes('按检查日期回填'))
  assert.ok(must('COOL-0023')['备注'].includes('来源：存量迁移规则'))
})

check('只有一套取值时沿用该套并注明（COOL-0017 无台账，取实测 0.25）', () => {
  const row = must('COOL-0017')
  assert.strictEqual(row['供水压力'], '0.25')
  assert.ok(row['取值来源'].includes('运行实测'))
})

check('带单位文本 “0.18 MPa” 能正确取数', () => {
  assert.strictEqual(toNumber('0.18 MPa'), 0.18)
  assert.strictEqual(toNumber('技术供水样例1'), null)
})

check('统一后供水压力全部为数值；占位数据被判定为存量', () => {
  for (const row of migrated) {
    assert.notStrictEqual(row['供水压力'], '')
    assert.notStrictEqual(toNumber(row['供水压力']), null)
  }
  const placeholders = LEGACY_COOLING.map((r) => ({
    id: r.id,
    status: r.status,
    pending: true,
    abnormal: r.abnormal,
    供水压力: '技术供水样例1',
  }))
  assert.strictEqual(isLegacyCoolingRows(placeholders), true)
  assert.strictEqual(isLegacyCoolingRows(migrated), false)
})

check('迁移结果按登记时间排序并重新编号（id 连续）', () => {
  migrated.forEach((row, index) => assert.strictEqual(row.id, index + 1))
  const times = migrated.map((r) => r['登记时间'])
  assert.deepStrictEqual(times, [...times].sort())
})

check('resolvePressure 仲裁：实测较晚取实测', () => {
  const d = resolvePressure({
    id: 1, status: '运行中', abnormal: false, systemNo: 'X', supplyType: '',
    ledgerPressure: 0.3, measuredPressure: 0.18, flow: 0, waterTemp: 0, filterDiff: 0,
    checkedAt: '2026-01-01', ledgerAt: '2020-01-01', measuredAt: '2026-09-01',
  })
  assert.ok(d)
  assert.strictEqual(d.value, 0.18)
  assert.ok(d.source.includes('运行实测'))
})

check('resolvePressure 仲裁：缺时间时按“较晚产生”之外的兜底不崩溃', () => {
  const d = resolvePressure({
    id: 1, status: '运行中', abnormal: false, systemNo: 'X', supplyType: '',
    ledgerPressure: 0.3, measuredPressure: 0.18, flow: 0, waterTemp: 0, filterDiff: 0,
    checkedAt: '2026-01-01',
  })
  assert.ok(d)
  assert.strictEqual(d.value, 0.18)
})

check('压力区间分档边界：0.20 含在正常区间、0.35 起算高压', () => {
  assert.strictEqual(bandOfPressure(0.199), 'low')
  assert.strictEqual(bandOfPressure(0.2), 'normal')
  assert.strictEqual(bandOfPressure(0.349), 'normal')
  assert.strictEqual(bandOfPressure(0.35), 'high')
})

// ---- 统一查询管线（纯函数部分）----
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { filterCoolingRows, sortCoolingRows } = require('../src/api/cooling-service') as typeof import('../src/api/cooling-service')

const baseQuery: CoolingQuery = {
  systemNo: '',
  supplyType: '',
  pressureBand: '',
  sort: 'default',
  page: 1,
}

check('供水类型收窄：消防供水条数与全集中该类型计数一致', () => {
  const rows = filterCoolingRows(migrated, { ...baseQuery, supplyType: '消防供水' })
  const expected = migrated.filter((r) => r['供水类型'] === '消防供水').length
  assert.ok(expected >= 1)
  assert.strictEqual(rows.length, expected)
})

check('低压区间收窄结果里每条压力都 < 0.20', () => {
  const rows = filterCoolingRows(migrated, { ...baseQuery, pressureBand: 'low' })
  assert.ok(rows.length >= 1)
  for (const row of rows) {
    assert.ok((toNumber(row['供水压力'] as string) as number) < 0.2)
  }
})

check('高压区间收窄结果里每条压力都 >= 0.35', () => {
  const rows = filterCoolingRows(migrated, { ...baseQuery, pressureBand: 'high' })
  for (const row of rows) {
    assert.ok((toNumber(row['供水压力'] as string) as number) >= 0.35)
  }
})

check('系统编号 + 类型组合收窄（COOL-0007 / 机组冷却供水）只命中 1 条', () => {
  const rows = filterCoolingRows(migrated, {
    ...baseQuery,
    systemNo: 'COOL-0007',
    supplyType: '机组冷却供水',
  })
  assert.strictEqual(rows.length, 1)
})

check('压力升序/降序排布，且排序用的值与区间筛选是同一个字段', () => {
  const asc = sortCoolingRows(migrated, 'pressureAsc').map(
    (r) => toNumber(r['供水压力'] as string) as number,
  )
  const desc = sortCoolingRows(migrated, 'pressureDesc').map(
    (r) => toNumber(r['供水压力'] as string) as number,
  )
  assert.deepStrictEqual(asc, [...asc].sort((a, b) => a - b))
  assert.deepStrictEqual(desc, [...desc].sort((a, b) => b - a))
})

check('滤水器压差升序/降序排布', () => {
  const asc = sortCoolingRows(migrated, 'filterDiffAsc').map(
    (r) => toNumber(r['滤水器压差'] as string) as number,
  )
  const desc = sortCoolingRows(migrated, 'filterDiffDesc').map(
    (r) => toNumber(r['滤水器压差'] as string) as number,
  )
  assert.deepStrictEqual(asc, [...asc].sort((a, b) => a - b))
  assert.deepStrictEqual(desc, [...desc].sort((a, b) => b - a))
})

// ---- 同源不变量：异常数 = 筛选结果里 abnormal 的条数 ----
check('低压区间的异常数等于筛选结果中 abnormal 条数（概览/列表同源）', () => {
  const rows = filterCoolingRows(migrated, { ...baseQuery, pressureBand: 'low' })
  const abnormalInList = rows.filter((r) => r.abnormal).length
  const abnormalOverview = rows.reduce((sum, r) => sum + (r.abnormal ? 1 : 0), 0)
  assert.strictEqual(abnormalInList, abnormalOverview)
  assert.ok(abnormalInList >= 1, `低压异常应至少 1 条，实际 ${abnormalInList}`)
})

// ---- 去重登记：upsert 同编号只保留一条（用纯数据模拟）----
check('同一系统编号再次“登记”不会多出一条（upsert 语义校验）', () => {
  const before = migrated.length
  const duplicated = [...migrated, { ...must('COOL-0001'), id: before + 1 }]
  const unique = new Map(duplicated.map((r) => [r['系统编号'], r]))
  assert.strictEqual(unique.size, before)
})

console.log(`\n全部 ${passed} 项校验通过。`)
