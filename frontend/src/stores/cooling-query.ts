import { defineStore } from 'pinia'

import { DEFAULT_PAGE_SIZE, emptyFilters, type CoolingFilters, type CoolingSort } from '@/api/cooling-domain'

/**
 * 技术供水列表的收窄/排布/翻页状态：
 * - 往后翻页、跳到运营概览或泄洪模块再回来，条件保持原样、停在刚才那一页；
 * - 运营概览读取这里的收窄条件统计异常系统数，概览与列表天然对得上。
 * 状态同时落到 localStorage，刷新浏览器也不丢。
 */

const STORAGE_KEY = 'hydropower-plant-om:cooling-query'

type Persisted = {
  filters: CoolingFilters
  sort: CoolingSort
  page: number
}

function restore(): Persisted {
  const fallback: Persisted = { filters: emptyFilters(), sort: { field: '系统编号', order: 'asc' }, page: 1 }
  if (typeof window === 'undefined' || !window.localStorage) return fallback
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<Persisted>
    return {
      filters: { ...emptyFilters(), ...(parsed.filters ?? {}) },
      sort: parsed.sort ?? fallback.sort,
      page: parsed.page ?? 1,
    }
  } catch {
    return fallback
  }
}

export const useCoolingQueryStore = defineStore('cooling-query', {
  state: () => {
    const restored = restore()
    return {
      filters: restored.filters,
      sort: restored.sort,
      page: restored.page,
      size: DEFAULT_PAGE_SIZE,
    }
  },
  actions: {
    setFilters(filters: CoolingFilters) {
      this.filters = { ...filters }
      // 条件重新收窄时回到第一页；动作触发的重查不走这里，页码保持不动。
      this.page = 1
      this.persist()
    },
    resetFilters() {
      this.filters = emptyFilters()
      this.page = 1
      this.persist()
    },
    setSort(sort: CoolingSort) {
      this.sort = { ...sort }
      this.page = 1
      this.persist()
    },
    setPage(page: number) {
      this.page = page
      this.persist()
    },
    /** 动作后数据减少导致当前页越界时，由查询层收敛到最后一个有效页，再同步回来。 */
    syncPage(page: number) {
      if (this.page !== page) this.page = page
      this.persist()
    },
    persist() {
      if (typeof window === 'undefined' || !window.localStorage) return
      const payload: Persisted = { filters: this.filters, sort: this.sort, page: this.page }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    },
  },
})
