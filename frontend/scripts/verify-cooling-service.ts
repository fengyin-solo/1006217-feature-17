/* eslint-disable no-console */
// 服务层集成校验：用内存版 localStorage 跑通迁移落盘、查询/概览/导出同源、
// 泄洪待办跨模块幂等、同编号重复登记只生效一次、异常动作联动。
import assert from 'node:assert'
import type * as CoolingService from '../src/api/cooling-service'
import type * as LocalService from '../src/api/local-service'
import type * as LocalStore from '../src/data/local-store'
import type { EntryRow, CoolingQuery } from '../src/data/types'

// ---- 最小浏览器环境桩：必须在引入数据层之前装好 ----
const memory = new Map<string, string>()
const storageLike = {
  getItem: (key: string) => (memory.has(key) ? (memory.get(key) as string) : null),
  setItem: (key: string, value: string) => {
    memory.set(key, value)
  },
  removeItem: (key: string) => {
    memory.delete(key)
  },
}
globalThis.window = { localStorage: storageLike } as unknown as Window & typeof globalThis
globalThis.localStorage = storageLike as unknown as Storage

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

function Q(partial: Partial<CoolingQuery> = {}): CoolingQuery {
  return { systemNo: '', supplyType: '', pressureBand: '', sort: 'default', page: 1, ...partial }
}
function findOrThrow(rows: Entry[], predicate: (r: EntryRow) => boolean): EntryRow {
  const row = rows.find(predicate)
  assert.ok(row, '未找到满足条件的记录')
  return row as EntryRow
}
type Entry = EntryRow

const coolingService = require('../src/api/cooling-service') as typeof CoolingService
const localService = require('../src/api/local-service') as typeof LocalService
const store = require('../src/data/local-store') as typeof LocalStore
const { queryCooling, coolingCounts, upsertCooling, pushFloodTodo } = coolingService
const { loadOverview, runAction, exportEntries } = localService
const { listRows } = store

function overviewCooling(q: CoolingQuery) {
  const row = loadOverview(q).modules.find((m) => m.key === 'cooling')
  assert.ok(row)
  return row as NonNullable<ReturnType<typeof loadOverview>['modules'][number]>
}
function overviewFlood(q: CoolingQuery) {
  const row = loadOverview(q).modules.find((m) => m.key === 'flood')
  assert.ok(row)
  return row as NonNullable<ReturnType<typeof loadOverview>['modules'][number]>
}

// 首次访问触发播种 + 迁移落盘
const firstPage = queryCooling(Q())
check('首次查询触发存量迁移：共 26 个系统、每页 8 条、共 4 页', () => {
  assert.strictEqual(firstPage.total, 26)
  assert.strictEqual(firstPage.items.length, 8)
  assert.strictEqual(firstPage.pages, 4)
  assert.strictEqual(firstPage.page, 1)
})

check('概览「技术供水」异常数/条数与 coolingCounts 完全一致', () => {
  const q = Q()
  const coolingRow = overviewCooling(q)
  const counts = coolingCounts(q)
  assert.strictEqual(coolingRow.created, counts.total)
  assert.strictEqual(coolingRow.abnormal, counts.abnormal)
  assert.strictEqual(coolingRow.pending, counts.pending)
})

check('收窄到低压区间：列表异常数 == 概览异常数（不会列表三台概览两台）', () => {
  const q = Q({ pressureBand: 'low' })
  const low = queryCooling(q)
  const counts = coolingCounts(q)
  const coolingRow = overviewCooling(q)
  assert.strictEqual(coolingRow.abnormal, counts.abnormal)
  assert.strictEqual(coolingRow.created, low.total)
  assert.ok(low.total >= 1)
  // 低压区间里的每条压力都确实落在该区间
  for (const item of low.items) {
    assert.ok(Number(item['供水压力']) < 0.2)
  }
})

check('另存（导出）条数 = 收窄后条数，且导出内容每行列数与表头一致', () => {
  const q = Q({ supplyType: '机组冷却供水', sort: 'pressureAsc', page: 2 })
  const result = queryCooling(q)
  const exported = exportEntries('cooling', q)
  const lines = exported.content.split('\n')
  const dataLines = lines.slice(1)
  assert.strictEqual(exported.count, result.total)
  assert.strictEqual(dataLines.length, result.total)
  const columns = lines[0].split(',')
  for (const line of dataLines) {
    assert.strictEqual(line.split(',').length, columns.length)
  }
})

check('无收窄条件时导全部 26 条', () => {
  assert.strictEqual(exportEntries('cooling', Q()).count, 26)
})

check('同一系统编号重复登记：第二次覆盖，不新增；且只保留最后一版（无中间态）', () => {
  const before = listRows('cooling').length
  const draft = {
    systemNo: 'COOL-0099', supplyType: '消防供水', pressure: '0.30',
    flow: '80', waterTemp: '25', filterDiff: '0.07', checkedAt: '2026-10-01',
  }
  const r1 = upsertCooling(draft)
  const r2 = upsertCooling(draft)
  assert.ok(r1.ok)
  assert.ok(r2.ok)
  assert.strictEqual(listRows('cooling').length, before + 1)
  const cover = upsertCooling({ ...draft, pressure: '0.33' })
  assert.ok(cover.ok)
  assert.strictEqual(listRows('cooling').length, before + 1)
  const row = findOrThrow(listRows('cooling'), (r) => r['系统编号'] === 'COOL-0099')
  assert.strictEqual(row['供水压力'], '0.33')
  assert.ok(String(row['备注']).includes('覆盖更新'))
})

check('非法登记被拒绝：空编号 / 非数值压力 / 空类型', () => {
  assert.strictEqual(
    upsertCooling({ systemNo: '', supplyType: '消防供水', pressure: '0.3', flow: '', waterTemp: '', filterDiff: '', checkedAt: '2026-10-01' }).ok,
    false,
  )
  assert.strictEqual(
    upsertCooling({ systemNo: 'X1', supplyType: '', pressure: '0.3', flow: '', waterTemp: '', filterDiff: '', checkedAt: '2026-10-01' }).ok,
    false,
  )
  assert.strictEqual(
    upsertCooling({ systemNo: 'X1', supplyType: '消防供水', pressure: '偏高', flow: '', waterTemp: '', filterDiff: '', checkedAt: '2026-10-01' }).ok,
    false,
  )
})

check('标记异常：abnormal 置真，且概览异常数同步 +1；重复标记不二次生效', () => {
  const q = Q()
  const beforeCount = coolingCounts(q).abnormal
  const target = findOrThrow(listRows('cooling'), (r) => String(r.status) === '运行中' && !r.abnormal)
  const res = runAction('cooling', Number(target.id), '标记异常')
  assert.ok(res.ok, res.message)
  const after = findOrThrow(listRows('cooling'), (r) => r.id === target.id)
  assert.strictEqual(after.abnormal, true)
  assert.strictEqual(coolingCounts(q).abnormal, beforeCount + 1)
  const again = runAction('cooling', Number(target.id), '标记异常')
  assert.strictEqual(again.ok, false)
})

check('跨模块：落泄洪待办后泄洪条数+1、概览待处理联动；重复落只生效一次', () => {
  const q = Q()
  const floodBefore = overviewFlood(q)
  const system = findOrThrow(listRows('cooling'), (r) => r.abnormal)
  const r1 = pushFloodTodo(system, '值班管理员')
  const r2 = pushFloodTodo(system, '值班管理员')
  assert.ok(r1.ok)
  assert.strictEqual(r2.ok, false)
  const todos = listRows('flood').filter((r) => String(r['待办事项']).includes(String(system['系统编号'])))
  assert.strictEqual(todos.length, 1)
  const floodAfter = overviewFlood(q)
  assert.strictEqual(floodAfter.created, floodBefore.created + 1)
  assert.strictEqual(floodAfter.pending, floodBefore.pending + 1)
})

check('返回列表停在原页：第 3 页查询仍取第 3 页对应数据（页码由持久化 query 决定）', () => {
  const page3 = queryCooling(Q({ sort: 'pressureAsc', page: 3 }))
  assert.strictEqual(page3.page, 3)
  assert.strictEqual(page3.items.length, 8)
  const pressures = page3.items.map((r) => Number(r['供水压力']))
  assert.deepStrictEqual(pressures, [...pressures].sort((a, b) => a - b))
})

check('越界页码自动夹回最后一页，不跳回第一页也不越界', () => {
  const result = queryCooling(Q({ page: 99 }))
  assert.strictEqual(result.page, result.pages)
})

console.log(`\n服务层集成：全部 ${passed} 项校验通过。`)
