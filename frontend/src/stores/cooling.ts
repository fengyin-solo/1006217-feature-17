import { defineStore } from 'pinia'

import type { CoolingQuery, CoolingSortKey } from '@/data/types'

// 技术供水列表的收窄条件与页码：刷新、切到别的模块再回来都停在原处，不跳回第一页。
const STORAGE_KEY = 'hydropower-plant-om:cooling-query'
export const COOLING_PAGE_SIZE = 8

export const DEFAULT_COOLING_QUERY: CoolingQuery = {
  systemNo: '',
  supplyType: '',
  pressureBand: '',
  sort: 'default',
  page: 1,
}

function readStored(): CoolingQuery {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_COOLING_QUERY }
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return { ...DEFAULT_COOLING_QUERY }
  }
  try {
    return { ...DEFAULT_COOLING_QUERY, ...(JSON.parse(raw) as Partial<CoolingQuery>) }
  } catch {
    return { ...DEFAULT_COOLING_QUERY }
  }
}

export const useCoolingStore = defineStore('cooling-query', {
  state: () => ({
    query: readStored(),
  }),
  actions: {
    persist() {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.query))
      }
    },
    patch(patch: Partial<CoolingQuery>) {
      this.query = { ...this.query, ...patch }
      this.persist()
    },
    // 改收窄条件后重新查询，页码必须回到第一页；翻页本身不重置条件。
    applyFilters(next: Pick<CoolingQuery, 'systemNo' | 'supplyType' | 'pressureBand'>) {
      this.query = { ...this.query, ...next, page: 1 }
      this.persist()
    },
    setSort(sort: CoolingSortKey) {
      this.query = { ...this.query, sort, page: 1 }
      this.persist()
    },
    setPage(page: number) {
      this.query = { ...this.query, page }
      this.persist()
    },
    reset() {
      this.query = { ...DEFAULT_COOLING_QUERY }
      this.persist()
    },
  },
})
