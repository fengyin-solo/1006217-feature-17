<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。技术供水一行跟着列表收窄条件走，异常系统数两边永远对得上。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>登记条数</th><th>待处理</th><th>异常量</th><th>统计口径</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name" :class="{ 'row-linked': row.key === 'cooling' }">
          <td>
            <RouterLink v-if="row.key === 'cooling'" class="link" to="/cooling">
              {{ row.name }}（回列表停在原页）
            </RouterLink>
            <template v-else>{{ row.name }}</template>
          </td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>
            {{ row.abnormal }}
            <span v-if="row.key === 'cooling' && coolingActive" class="tag tag-scope">随条件变化</span>
          </td>
          <td class="scope-cell">{{ row.scope }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据；技术供水的收窄条件同样持久化。</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { useCoolingStore } from '@/stores/cooling'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const coolingStore = useCoolingStore()

const coolingActive = computed(
  () =>
    coolingStore.query.systemNo.trim() !== '' ||
    coolingStore.query.supplyType !== '' ||
    coolingStore.query.pressureBand !== '',
)

function refresh() {
  // 技术供水与列表共用同一查询口径，概览异常数即收窄后的异常数。
  const payload = loadOverview(coolingStore.query)
  cards.value = payload.cards
  moduleRows.value = payload.modules
}

onMounted(refresh)
</script>
