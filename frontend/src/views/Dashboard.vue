<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。技术供水的异常系统数跟随列表收窄条件，两边始终对得上。</p>
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
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>
            {{ row.name }}
            <span v-if="row.scoped" class="scope-badge">已按技术供水收窄条件</span>
          </td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td :class="{ 'stat-warn': row.abnormal > 0 }">{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>技术供水行与「技术供水」列表同源统计：列表里几台，这里就是几台</span>
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { useCoolingQueryStore } from '@/stores/cooling-query'
import type { OverviewResult } from '@/data/types'

const queryStore = useCoolingQueryStore()
const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])

function refresh() {
  // 概览与技术供水列表共用同一个收窄条件，异常系统数跟着条件变。
  const payload = loadOverview(queryStore.filters)
  cards.value = payload.cards
  moduleRows.value = payload.modules
}

onMounted(refresh)
</script>
