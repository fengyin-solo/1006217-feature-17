<template>
  <section class="page" data-module="cooling">
    <header class="page-head">
      <div>
        <h2>技术供水管理</h2>
        <p class="page-desc">
          供水压力、流量、滤水器压差、水温统一入口：按系统编号、供水类型、压力区间收窄，可按供水压力或滤水器压差排布先后，条件翻页不丢、返回停在原页。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记供水系统</button>
        <button class="btn" type="button" @click="exportRows">另存当前结果</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item legend-tip">另存条数与上表一致：{{ exportCount }} 条</span>
    </p>

    <form class="filter-bar" @submit.prevent="applyFilters">
      <label class="filter-item">
        <span>系统编号</span>
        <input v-model="draftFilters.systemNo" placeholder="如 COOL-0007" />
      </label>
      <label class="filter-item">
        <span>供水类型</span>
        <select v-model="draftFilters.supplyType">
          <option value="">全部类型</option>
          <option v-for="type in supplyTypes" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>压力区间（按运行时段实测统一值）</span>
        <select v-model="draftFilters.pressureBand">
          <option value="">全部区间</option>
          <option v-for="band in bands" :key="band.value" :value="band.value">{{ band.label }}</option>
        </select>
      </label>
      <button class="btn primary" type="submit">收窄查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="filter-bar sort-bar">
      <label class="filter-item">
        <span>排布先后（与区间筛选同一套压力取值）</span>
        <select :value="store.query.sort" @change="onSortChange(($event.target as HTMLSelectElement).value)">
          <option value="default">默认（按系统编号）</option>
          <option value="pressureAsc">供水压力从低到高</option>
          <option value="pressureDesc">供水压力从高到低</option>
          <option value="filterDiffAsc">滤水器压差从小到大</option>
          <option value="filterDiffDesc">滤水器压差从大到小</option>
        </select>
      </label>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in page.items" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="row.abnormal" class="tag tag-abnormal">异常</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link link-todo" type="button" @click="toFloodTodo(row)">
              落泄洪待办
            </button>
          </td>
        </tr>
        <tr v-if="!page.items.length">
          <td :colspan="columns.length + 2" class="empty-state">当前条件下没有供水系统，换个条件试试</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot pager">
      <span>共 {{ page.total }} 条 · 第 {{ page.page }} / {{ page.pages }} 页（每页 {{ page.size }} 条）</span>
      <span class="pager-buttons">
        <button class="btn" type="button" :disabled="page.page <= 1" @click="goPage(page.page - 1)">上一页</button>
        <button
          v-for="p in page.pages"
          :key="p"
          class="btn"
          :class="{ primary: p === page.page }"
          type="button"
          @click="goPage(p)"
        >
          {{ p }}
        </button>
        <button class="btn" type="button" :disabled="page.page >= page.pages" @click="goPage(page.page + 1)">
          下一页
        </button>
      </span>
    </footer>

    <p v-if="page.total" class="scope-hint">
      当前口径与运营概览「技术供水」行一致；切到概览或泄洪模块再回来，条件与本页页码保持原样。
    </p>

    <div v-if="showDialog" class="modal-mask" @click.self="closeCreate">
      <form class="modal" @submit.prevent="submitCreate">
        <h3>登记 / 更新供水系统</h3>
        <p class="modal-tip">同一系统编号重复提交按覆盖处理，只保留最后一版，不产生两条记录。</p>
        <label v-for="field in formFields" :key="field.key" class="form-item">
          <span>{{ field.label }}</span>
          <select v-if="field.key === 'supplyType'" v-model="draft[field.key]">
            <option value="">请选择</option>
            <option v-for="type in supplyTypes" :key="type" :value="type">{{ type }}</option>
          </select>
          <input
            v-else
            v-model="draft[field.key]"
            :type="field.key === 'checkedAt' ? 'date' : 'text'"
            :placeholder="field.placeholder"
          />
        </label>
        <footer class="modal-foot">
          <span v-if="formMessage" :class="formOk ? 'ok-text' : 'error-text'">{{ formMessage }}</span>
          <span class="modal-buttons">
            <button class="btn ghost" type="button" @click="closeCreate">取消</button>
            <button class="btn primary" type="submit" :disabled="submitting">
              {{ submitting ? '提交中…' : '提交登记' }}
            </button>
          </span>
        </footer>
      </form>
    </div>

    <p v-if="errorMessage" class="error-text page-tip">{{ errorMessage }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  runAction as applyAction,
} from '@/api/local-service'
import {
  filterCoolingRows,
  pushFloodTodo,
  queryCooling,
  sortCoolingRows,
  upsertCooling,
  type CoolingDraft,
} from '@/api/cooling-service'
import { PRESSURE_BANDS, SUPPLY_TYPES } from '@/data/cooling-migration'
import { listRows } from '@/data/local-store'
import { useCoolingStore } from '@/stores/cooling'
import { useSessionStore } from '@/stores/session'
import type { CoolingPageResult, CoolingSortKey, EntryRow } from '@/data/types'

const store = useCoolingStore()
const session = useSessionStore()

const columns = [
  '系统编号',
  '供水类型',
  '供水压力',
  '供水流量',
  '水温数值',
  '滤水器压差',
  '检查日期',
  '取值来源',
  '登记时间',
  '备注',
]
const actions = ['提交检查', '标记异常', '停运系统']
const statuses = ['待检查', '运行中', '异常', '已停运']
const bands = PRESSURE_BANDS
const supplyTypes = SUPPLY_TYPES

const formFields: { key: keyof CoolingDraft; label: string; placeholder: string }[] = [
  { key: 'systemNo', label: '系统编号', placeholder: '如 COOL-0007' },
  { key: 'supplyType', label: '供水类型', placeholder: '' },
  { key: 'pressure', label: '供水压力（MPa，唯一口径）', placeholder: '如 0.28' },
  { key: 'flow', label: '供水流量（m³/h）', placeholder: '如 120' },
  { key: 'waterTemp', label: '水温数值（℃）', placeholder: '如 27.5' },
  { key: 'filterDiff', label: '滤水器压差（MPa）', placeholder: '如 0.08' },
  { key: 'checkedAt', label: '检查日期', placeholder: '' },
]

const emptyPage: CoolingPageResult = { items: [], total: 0, page: 1, size: 8, pages: 1 }
const page = ref<CoolingPageResult>({ ...emptyPage })
const errorMessage = ref('')

// 条件输入框是草稿，点“收窄查询”才生效；生效的条件持久化在 store 里。
const draftFilters = reactive({
  systemNo: store.query.systemNo,
  supplyType: store.query.supplyType,
  pressureBand: store.query.pressureBand,
})

const stats = computed(() => {
  const all = storeScopedRows.value
  return [
    { label: '当前条件运行系统', value: all.filter((row) => String(row.status) === '运行中').length },
    { label: '当前条件异常系统', value: all.filter((row) => row.abnormal).length },
    { label: '当前条件待检查系统', value: all.filter((row) => String(row.status) === '待检查').length },
  ]
})

// 状态汇总与统计卡片都按收窄后的全量（不是当前页）统计，和概览同源。
const storeScopedRows = ref<EntryRow[]>([])
const exportCount = ref(0)

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: storeScopedRows.value.filter((row) => String(row.status) === status).length,
  })),
)

function reload() {
  errorMessage.value = ''
  try {
    const result = queryCooling(store.query)
    page.value = result
    // 若持久化的页码超出范围（数据被删/条件变化），queryCooling 已夹回合法页，回写保持一致。
    if (result.page !== store.query.page) {
      store.setPage(result.page)
    }
    storeScopedRows.value = sortCoolingRows(
      filterCoolingRows(listRows('cooling'), store.query),
      store.query.sort,
    )
    exportCount.value = storeScopedRows.value.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '技术供水列表读取失败'
  }
}

function applyFilters() {
  store.applyFilters({ ...draftFilters })
  reload()
}

function resetFilters() {
  store.reset()
  draftFilters.systemNo = ''
  draftFilters.supplyType = ''
  draftFilters.pressureBand = ''
  reload()
}

function onSortChange(value: string) {
  store.setSort(value as CoolingSortKey)
  reload()
}

function goPage(target: number) {
  if (target < 1 || target > page.value.pages || target === page.value.page) {
    return
  }
  store.setPage(target)
  reload()
}

function exportRows() {
  downloadEntries('cooling', store.query)
  errorMessage.value = `已另存当前收窄结果，共 ${exportCount.value} 条，与页面条数一致`
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction('cooling', Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function toFloodTodo(row: EntryRow) {
  errorMessage.value = ''
  const result = pushFloodTodo(row, session.operator)
  errorMessage.value = result.message
}

const showDialog = ref(false)
const submitting = ref(false)
const formMessage = ref('')
const formOk = ref(false)
const draft = reactive<CoolingDraft>({
  systemNo: '',
  supplyType: '',
  pressure: '',
  flow: '',
  waterTemp: '',
  filterDiff: '',
  checkedAt: '',
})

function openCreate() {
  showDialog.value = true
  formMessage.value = ''
}

function closeCreate() {
  showDialog.value = false
  submitting.value = false
}

function submitCreate() {
  submitting.value = true
  const result = upsertCooling({ ...draft })
  submitting.value = false
  formMessage.value = result.message
  formOk.value = result.ok
  if (!result.ok) {
    return
  }
  Object.assign(draft, {
    systemNo: '',
    supplyType: '',
    pressure: '',
    flow: '',
    waterTemp: '',
    filterDiff: '',
    checkedAt: '',
  })
  showDialog.value = false
  reload()
}

onMounted(() => {
  draftFilters.systemNo = store.query.systemNo
  draftFilters.supplyType = store.query.supplyType
  draftFilters.pressureBand = store.query.pressureBand
  reload()
})
</script>
