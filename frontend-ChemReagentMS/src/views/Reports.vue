<script setup>
import { ref, onMounted } from 'vue'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent } from 'echarts/components'

use([CanvasRenderer, BarChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent])

const loading = { inbound: false, outbound: false, stock: false }

function parseReport(raw) {
  if (!raw) return { names: [], values: [] }
  const rawNames = (raw.dataList || '').split(',').filter(Boolean)
  const rawValues = (raw.numberList || '').split(',').map(Number)
  const map = {}
  rawNames.forEach((n, i) => { map[n] = (map[n] || 0) + (rawValues[i] || 0) })
  const entries = Object.entries(map)
  return { names: entries.map(e => e[0]), values: entries.map(e => e[1]) }
}

function barOption(title, names, values, color) {
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', data: names, axisLabel: { rotate: 30, fontSize: 11 } },
    yAxis: { type: 'value', name: '数量' },
    series: [{ name: title, type: 'bar', data: values, itemStyle: { color } }],
  }
}

// ---------- 入库统计 ----------
const inboundDate = ref([null, null])
const inboundOpt = ref({})
async function loadInbound() {
  loading.inbound = true
  try {
    const [s, e] = inboundDate.value
    const params = {}
    if (s && e) { params.startDate = s; params.endDate = e }
    else {
      const now = new Date(); const d30 = new Date(now.getTime() - 30*86400000)
      const fmt = d => d.toISOString().slice(0,10)
      params.startDate = fmt(d30); params.endDate = fmt(now)
    }
    const res = await request.get('/report/top10/inbound', { params })
    const { names, values } = parseReport(res.data)
    inboundOpt.value = barOption('入库次数', names, values, '#409eff')
  } catch { inboundOpt.value = {} }
  finally { loading.inbound = false }
}

// ---------- 出库排名 ----------
const outboundDate = ref([null, null])
const outboundOpt = ref({})
async function loadOutbound() {
  loading.outbound = true
  try {
    const [s, e] = outboundDate.value
    const params = {}
    if (s && e) { params.startDate = s; params.endDate = e }
    else {
      const now = new Date(); const d30 = new Date(now.getTime() - 30*86400000)
      const fmt = d => d.toISOString().slice(0,10)
      params.startDate = fmt(d30); params.endDate = fmt(now)
    }
    const res = await request.get('/report/top10/outbound', { params })
    const { names, values } = parseReport(res.data)
    outboundOpt.value = barOption('出库次数', names, values, '#f56c6c')
  } catch { outboundOpt.value = {} }
  finally { loading.outbound = false }
}

// ---------- 库存概览 ----------
const stockOpt = ref({})
async function loadStock() {
  loading.stock = true
  try {
    const [high, low] = await Promise.all([
      request.get('/report/top10/high'),
      request.get('/report/top10/low'),
    ])
    const h = parseReport(high.data)
    const l = parseReport(low.data)
    const allNames = [...new Set([...h.names, ...l.names])]
    const hMap = {}, lMap = {}
    h.names.forEach((n, i) => { hMap[n] = h.values[i] })
    l.names.forEach((n, i) => { lMap[n] = l.values[i] })
    stockOpt.value = {
      tooltip: { trigger: 'axis' },
      legend: { data: ['高库存', '低库存'] },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category', data: allNames, axisLabel: { rotate: 30, fontSize: 11 } },
      yAxis: { type: 'value', name: '库存量' },
      series: [
        { name: '高库存', type: 'bar', data: allNames.map(n => hMap[n] || 0), itemStyle: { color: '#67c23a' } },
        { name: '低库存', type: 'bar', data: allNames.map(n => lMap[n] || 0), itemStyle: { color: '#e6a23c' } },
      ],
    }
  } catch { stockOpt.value = {} }
  finally { loading.stock = false }
}

async function exportInventory() {
  try {
    const res = await request.get('/report/export/inventory', { responseType: 'blob' })
    const url = window.URL.createObjectURL(res)
    const a = document.createElement('a')
    a.href = url
    a.download = '库存报表.xlsx'
    a.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('库存报表导出成功')
  } catch { ElMessage.error('导出失败') }
}
async function exportInbound() {
  try {
    const res = await request.get('/report/export/inbound', { responseType: 'blob' })
    const url = window.URL.createObjectURL(res)
    const a = document.createElement('a')
    a.href = url
    a.download = '入库记录报表.xlsx'
    a.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('入库报表导出成功')
  } catch { ElMessage.error('导出失败') }
}

onMounted(() => {
  loadInbound()
  loadOutbound()
  loadStock()
})
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <h2>统计报表</h2>
      <div class="header-actions">
        <el-button @click="exportInventory" icon="Download">导出库存报表</el-button>
        <el-button @click="exportInbound" icon="Download">导出入库报表</el-button>
      </div>
    </div>

    <!-- 入库统计 -->
    <el-card style="margin-top:16px" v-loading="loading.inbound">
      <template #header>
        <div class="chart-header">
          <span>入库统计 — Top10</span>
          <el-date-picker v-model="inboundDate" type="daterange" range-separator="至"
            start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD"
            style="width:260px" @change="loadInbound" size="small" />
        </div>
      </template>
      <v-chart :option="inboundOpt" autoresize style="height:300px" />
    </el-card>

    <!-- 出库排名 -->
    <el-card style="margin-top:16px" v-loading="loading.outbound">
      <template #header>
        <div class="chart-header">
          <span>出库排名 — Top10</span>
          <el-date-picker v-model="outboundDate" type="daterange" range-separator="至"
            start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD"
            style="width:260px" @change="loadOutbound" size="small" />
        </div>
      </template>
      <v-chart :option="outboundOpt" autoresize style="height:300px" />
    </el-card>

    <!-- 库存概览 -->
    <el-card style="margin-top:16px" v-loading="loading.stock">
      <template #header><span>库存概览 — 高/低库存 Top10</span></template>
      <v-chart :option="stockOpt" autoresize style="height:300px" />
    </el-card>
  </div>
</template>

<style scoped>
.page-header { display:flex; justify-content:space-between; align-items:center; }
.chart-header { display:flex; justify-content:space-between; align-items:center; }
</style>
