<template>
  <section class="page" data-module="cooling">
    <header class="page-head">
      <div>
        <h2>技术供水管理</h2>
        <p class="page-desc">
          按系统编号、供水类型、压力区间快速收窄，可按供水压力或滤水器压差排布；
          压力与压差统一取较晚产生的一套（见「取值来源」），筛选与排序同一口径。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记/覆盖供水系统</button>
        <button class="btn" type="button" @click="exportRows">
          另存当前结果（{{ counts.total }} 条）
        </button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">运行系统（收窄后）</span>
        <strong class="stat-value">{{ counts.running }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">异常系统（收窄后，与运营概览一致）</span>
        <strong class="stat-value" :class="{ 'stat-warn': counts.abnormal > 0 }">{{ counts.abnormal }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待检查系统（收窄后）</span>
        <strong class="stat-value">{{ counts.pending }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">收窄命中 / 全部</span>
        <strong class="stat-value">{{ counts.total }} / {{ allTotal }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item legend-note">
        取值规则：登记值与运行实测值并存时，以较晚产生的一套为准并已统一回写
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="applyFilters">
      <label class="filter-item">
        <span>系统编号</span>
        <input v-model="draftFilters.keyword" placeholder="如 COOL-2011" />
      </label>
      <label class="filter-item">
        <span>供水类型</span>
        <select v-model="draftFilters.systemType">
          <option value="">全部类型</option>
          <option v-for="t in WATER_TYPES" :key="t" :value="t">{{ t }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>压力区间（MPa，运行口径）</span>
        <select v-model="rangePreset" @change="applyRangePreset">
          <option v-for="r in PRESSURE_RANGES" :key="r.label" :value="r.label">{{ r.label }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>压力下限</span>
        <input v-model="draftFilters.pressureMin" inputmode="decimal" placeholder="0.30" class="num-input" />
      </label>
      <label class="filter-item">
        <span>压力上限</span>
        <input v-model="draftFilters.pressureMax" inputmode="decimal" placeholder="0.60" class="num-input" />
      </label>
      <button class="btn" type="submit">收窄</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="sort-bar">
      <span class="sort-label">排布先后：</span>
      <button
        v-for="opt in sortOptions"
        :key="opt.field + opt.order"
        class="btn"
        :class="{ primary: isActiveSort(opt) }"
        type="button"
        @click="applySort(opt)"
      >
        {{ opt.label }}
      </button>
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
        <tr v-for="row in rows" :key="String(row.id)">
          <td>{{ row['系统编号'] }}</td>
          <td>{{ row['供水类型'] }}</td>
          <td>{{ fmt(row['供水压力']) }}</td>
          <td>{{ fmt(row['供水流量']) }}</td>
          <td>{{ fmt(row['水温数值']) }}</td>
          <td>{{ fmt(row['滤水器压差']) }}</td>
          <td>
            {{ row['取值来源'] }}
            <div v-if="row['备注']" class="cell-note" :title="String(row['备注'])">{{ row['备注'] }}</div>
          </td>
          <td>{{ row['检查日期'] }}</td>
          <td>{{ row['系统状态'] }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in statusActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button
              class="link link-warn"
              type="button"
              :disabled="todoExists(row)"
              :title="todoExists(row) ? '已在泄洪待办清单，重复提交不生效' : ''"
              @click="sendToFlood(row)"
            >
              {{ todoExists(row) ? '已在泄洪待办' : '列入泄洪待办' }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">当前收窄条件下没有供水系统，可放宽条件或登记新系统</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>
        收窄命中 <strong>{{ total }}</strong> 条，第 {{ page }} / {{ pageCount }} 页
        （条件与页码在离开页面后保持，返回时停在本页）
      </span>
      <span class="pager">
        <button class="btn" type="button" :disabled="page <= 1" @click="goPage(1)">首页</button>
        <button class="btn" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <button class="btn" type="button" :disabled="page >= pageCount" @click="goPage(page + 1)">下一页</button>
        <button class="btn" type="button" :disabled="page >= pageCount" @click="goPage(pageCount)">末页</button>
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-if="okMessage" class="ok-text">{{ okMessage }}</span>
    </footer>

    <!-- 登记/覆盖：同系统编号重复提交只生效一次，覆盖不留中间态 -->
    <div v-if="creating" class="modal-mask" @click.self="closeCreate">
      <form class="modal" @submit.prevent="submitCreate">
        <h3>登记 / 覆盖供水系统</h3>
        <p class="modal-note">系统编号已存在时整行覆盖为本次版本（不留中间态），不会新增第二条。</p>
        <div class="form-grid">
          <label><span>系统编号 *</span><input v-model="draft.系统编号" required placeholder="COOL-2015" /></label>
          <label>
            <span>供水类型</span>
            <select v-model="draft.供水类型">
              <option v-for="t in CREATE_TYPES" :key="t" :value="t">{{ t }}</option>
            </select>
          </label>
          <label><span>供水压力登记值 (MPa)</span><input v-model="draft.供水压力" inputmode="decimal" placeholder="0.45" /></label>
          <label><span>滤水器压差登记值 (MPa)</span><input v-model="draft.滤水器压差" inputmode="decimal" placeholder="0.035" /></label>
          <label><span>供水流量 (m³/h)</span><input v-model="draft.供水流量" inputmode="decimal" placeholder="120" /></label>
          <label><span>水温数值 (℃)</span><input v-model="draft.水温数值" inputmode="decimal" placeholder="28.0" /></label>
          <label><span>检查日期（登记时间）</span><input v-model="draft.检查日期" type="date" /></label>
          <label>
            <span>系统状态</span>
            <select v-model="draft.系统状态">
              <option v-for="s in statuses" :key="s" :value="s">{{ s }}</option>
            </select>
          </label>
          <label><span>运行实测时间（晚于检查日期则实测值生效）</span><input v-model="draft.运行实测时间" type="date" /></label>
          <label><span>供水压力实测值 (MPa)</span><input v-model="draft.供水压力实测值" inputmode="decimal" placeholder="0.42" /></label>
          <label><span>滤水器压差实测值 (MPa)</span><input v-model="draft.滤水器压差实测值" inputmode="decimal" placeholder="0.038" /></label>
        </div>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeCreate">取消</button>
          <button class="btn primary" type="submit">提交（幂等）</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  CREATE_TYPES,
  PRESSURE_RANGES,
  WATER_TYPES,
  type CoolingDraft,
  type CoolingSort,
} from '@/api/cooling-domain'
import {
  coolingOverviewCounts,
  createFloodTodoFromCooling,
  downloadCoolingEntries,
  isFloodTodoExists,
  listCooling,
  moduleMeta,
  runAction as applyAction,
  saveCoolingSystem,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import { useCoolingQueryStore } from '@/stores/cooling-query'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('cooling')
const session = useSessionStore()
const queryStore = useCoolingQueryStore()

const columns = ['系统编号', '供水类型', '供水压力', '供水流量', '水温数值', '滤水器压差', '取值来源', '检查日期']
const statuses = ['待检查', '运行中', '异常', '已停运']

const sortOptions: ({ field: CoolingSort['field']; order: CoolingSort['order']; label: string })[] = [
  { field: '系统编号', order: 'asc', label: '系统编号' },
  { field: '供水压力', order: 'asc', label: '压力从低到高' },
  { field: '供水压力', order: 'desc', label: '压力从高到低' },
  { field: '滤水器压差', order: 'desc', label: '压差从大到小' },
  { field: '滤水器压差', order: 'asc', label: '压差从小到大' },
]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const page = ref(1)
const pageCount = ref(1)
const errorMessage = ref('')
const okMessage = ref('')

// 输入态与已生效条件分开：点「收窄」后才覆盖查询条件（生效后翻页一直带着）。
const draftFilters = reactive({ ...queryStore.filters })
const rangePreset = ref(PRESSURE_RANGES[0].label)
const todoMarks = ref<Record<string, boolean>>({})

const counts = computed(() => coolingOverviewCounts(queryStore.filters))
const allTotal = computed(() => coolingOverviewCounts({ keyword: '', systemType: '', pressureMin: '', pressureMax: '' }).total)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function fmt(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function isActiveSort(opt: { field: CoolingSort['field']; order: CoolingSort['order'] }): boolean {
  return queryStore.sort.field === opt.field && queryStore.sort.order === opt.order
}

function todoExists(row: EntryRow): boolean {
  return Boolean(todoMarks.value[String(row['系统编号'])])
}

function statusActions(row: EntryRow): string[] {
  // 已到终态的动作不再给出，减少无效重复提交。
  const map: Record<string, string[]> = {
    待检查: ['提交检查'],
    运行中: ['标记异常', '停运系统'],
    异常: ['停运系统'],
    已停运: [],
  }
  return map[String(row.status)] ?? meta.actions
}

function applyRangePreset() {
  const hit = PRESSURE_RANGES.find((r) => r.label === rangePreset.value)
  if (hit) {
    draftFilters.pressureMin = hit.min
    draftFilters.pressureMax = hit.max
  }
}

function applyFilters() {
  errorMessage.value = ''
  const min = draftFilters.pressureMin.trim()
  const max = draftFilters.pressureMax.trim()
  if (min && max && Number(min) > Number(max)) {
    errorMessage.value = '压力下限不能大于上限'
    return
  }
  queryStore.setFilters({
    keyword: draftFilters.keyword.trim(),
    systemType: draftFilters.systemType,
    pressureMin: min,
    pressureMax: max,
  })
  reload()
}

function resetFilters() {
  queryStore.resetFilters()
  draftFilters.keyword = ''
  draftFilters.systemType = ''
  draftFilters.pressureMin = ''
  draftFilters.pressureMax = ''
  rangePreset.value = PRESSURE_RANGES[0].label
  reload()
}

function applySort(opt: { field: CoolingSort['field']; order: CoolingSort['order'] }) {
  queryStore.setSort({ field: opt.field, order: opt.order })
  reload()
}

function goPage(target: number) {
  queryStore.setPage(target)
  reload()
}

function exportRows() {
  const count = downloadCoolingEntries({
    filters: queryStore.filters,
    sort: queryStore.sort,
    page: queryStore.page,
    size: queryStore.size,
  })
  flashOk(`已另存当前收窄结果，共 ${count} 条，与页面条数一致`)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  flashOk(result.message)
  reload()
}

function sendToFlood(row: EntryRow) {
  errorMessage.value = ''
  const result = createFloodTodoFromCooling(Number(row.id), session.operator)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  todoMarks.value[String(row['系统编号'])] = true
  flashOk(result.message)
}

const creating = ref(false)
const createError = ref('')
const emptyDraft = (): CoolingDraft => ({
  系统编号: '',
  供水类型: '机组冷却水',
  供水压力: '',
  供水流量: '',
  水温数值: '',
  滤水器压差: '',
  检查日期: new Date().toISOString().slice(0, 10),
  系统状态: '待检查',
  运行实测时间: '',
  供水压力实测值: '',
  滤水器压差实测值: '',
})
const draft = reactive<CoolingDraft>(emptyDraft())

function openCreate() {
  createError.value = ''
  Object.assign(draft, emptyDraft())
  creating.value = true
}

function closeCreate() {
  creating.value = false
}

function submitCreate() {
  createError.value = ''
  const result = saveCoolingSystem({ ...draft })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  creating.value = false
  flashOk(result.message)
  reload()
}

function flashOk(message: string) {
  okMessage.value = message
  window.setTimeout(() => {
    if (okMessage.value === message) okMessage.value = ''
  }, 3500)
}

/**
 * 重查：不重置页码。当前页因数据变化越界时，查询层收敛到最后一个有效页，
 * 并把页码同步回会话——返回列表时停在原处，而不是跳回第一页。
 */
function reload() {
  errorMessage.value = ''
  try {
    const payload = listCooling({
      filters: queryStore.filters,
      sort: queryStore.sort,
      page: queryStore.page,
      size: queryStore.size,
    })
    rows.value = payload.items
    total.value = payload.total
    page.value = payload.page
    pageCount.value = payload.pageCount
    queryStore.syncPage(payload.page)

    const marks: Record<string, boolean> = {}
    for (const row of payload.items) {
      marks[String(row['系统编号'])] = isFloodTodoExists(String(row['系统编号']))
    }
    todoMarks.value = marks
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '技术供水列表读取失败'
  }
}

onMounted(() => {
  // 输入框先按已持久化的条件回填，保持「条件还是刚才那样」。
  Object.assign(draftFilters, queryStore.filters)
  reload()
})
</script>
