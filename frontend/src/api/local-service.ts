import { MODULE_BY_KEY } from '../data/modules'
import { allRows, listRows, resetRows, saveRows } from '../data/local-store'
import type {
  ActionResult,
  CoolingQuery,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'
import {
  applyCoolingActionResult,
  coolingCounts,
  filterCoolingRows,
  sortCoolingRows,
} from './cooling-service'

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
  const updated: EntryRow =
    key === 'cooling'
      ? applyCoolingActionResult(rows[index], action, target)
      : {
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

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function exportEntries(
  key: string,
  coolingQuery?: CoolingQuery,
): { filename: string; content: string; count: number } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  // 技术供水另存的就是当前收窄+排布后的同一批结果，条数与页面呈现一致。
  const rows =
    key === 'cooling' && coolingQuery
      ? sortCoolingRows(filterCoolingRows(listRows(key), coolingQuery), coolingQuery.sort)
      : listRows(key)
  for (const row of rows) {
    lines.push(
      [row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status]
        .map(csvCell)
        .join(','),
    )
  }
  return {
    filename: `${meta.name}-清单.csv`,
    content: `﻿${lines.join('\n')}`,
    count: rows.length,
  }
}

export function downloadEntries(key: string, coolingQuery?: CoolingQuery): void {
  const { filename, content } = exportEntries(key, coolingQuery)
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

function scopeLabel(meta: ModuleMeta, coolingQuery?: CoolingQuery): string {
  if (meta.key !== 'cooling' || !coolingQuery) {
    return '全部登记'
  }
  const parts: string[] = []
  if (coolingQuery.systemNo.trim()) {
    parts.push(`编号含「${coolingQuery.systemNo.trim()}」`)
  }
  if (coolingQuery.supplyType) {
    parts.push(coolingQuery.supplyType)
  }
  if (coolingQuery.pressureBand) {
    parts.push(
      coolingQuery.pressureBand === 'low'
        ? '低压区间'
        : coolingQuery.pressureBand === 'normal'
          ? '正常压力区间'
          : '高压区间',
    )
  }
  return parts.length ? `收窄口径：${parts.join('、')}` : '全部登记'
}

export function loadOverview(coolingQuery?: CoolingQuery): OverviewResult {
  const rows = allRows()
  const cooling = coolingQuery ? coolingCounts(coolingQuery) : null
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    if (meta.key === 'cooling' && cooling) {
      // 技术供水概览数与列表同源：异常系统数跟着收窄条件变，不会列表三台、概览两台。
      return {
        key: meta.key,
        name: meta.name,
        created: cooling.total,
        pending: cooling.pending,
        abnormal: cooling.abnormal,
        scope: scopeLabel(meta, coolingQuery),
      }
    }
    return {
      key: meta.key,
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
      scope: scopeLabel(meta, coolingQuery),
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
