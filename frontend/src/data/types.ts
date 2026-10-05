/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { key: string; name: string; created: number; pending: number; abnormal: number; scope: string }[]
}

// 技术供水列表的收窄条件与排布方式：条件随会话持久化，翻页、跳走再回来都不丢。
export type CoolingSortKey =
  | 'default'
  | 'pressureAsc'
  | 'pressureDesc'
  | 'filterDiffAsc'
  | 'filterDiffDesc'

export type CoolingQuery = {
  systemNo: string
  supplyType: string
  pressureBand: string
  sort: CoolingSortKey
  page: number
}

export type CoolingPageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
  pages: number
}
