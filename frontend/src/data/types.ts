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
  modules: { name: string; key?: string; created: number; pending: number; abnormal: number; scoped?: boolean }[]
}

/** 技术供水列表的收窄条件：系统编号、供水类型精确收窄，压力按运行口径的生效值落区间。 */
export type CoolingFilters = {
  keyword: string
  systemType: string
  pressureMin: string
  pressureMax: string
}

/** 技术供水列表的排布口径：默认按系统编号，可按供水压力或滤水器压差数值排布。 */
export type CoolingSort = {
  field: '系统编号' | '供水压力' | '滤水器压差'
  order: 'asc' | 'desc'
}

export type CoolingQuery = {
  filters: CoolingFilters
  sort: CoolingSort
  page: number
  size: number
}
