<script setup>
import { ref, onMounted, computed } from 'vue'
import request from '@/utils/request'

// ---------- 统计卡片 ----------
const stats = ref({ reagentCount: 0, batchCount: 0, warningCount: 0, pendingAuditCount: 0 })
const statsLoading = ref(false)

async function loadStats() {
  statsLoading.value = true
  try {
    const base = { page: 1, pageSize: 1 }
    const [r1, r2, r3, r4] = await Promise.all([
      request.get('/reagents/', { params: { ...base, status: 0 } }),
      request.get('/reagentBatches', { params: base }),
      request.get('/warning/count'),
      request.get('/outboundOrderAudit', { params: base }),
    ])
    stats.value.reagentCount = r1.data?.total ?? 0
    stats.value.batchCount = r2.data?.total ?? 0
    stats.value.warningCount = r3.data ?? 0
    stats.value.pendingAuditCount = r4.data?.total ?? 0
  } catch { /* 静默 */ }
  finally { statsLoading.value = false }
}

// ---------- 图表 ----------
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, PieChart, LineChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent } from 'echarts/components'

use([CanvasRenderer, BarChart, PieChart, LineChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent])

const trendLoading = ref(false)
const pieLoading = ref(false)

function parseReport(raw) {
  if (!raw) return { names: [], values: [] }
  const rawNames = (raw.dataList || '').split(',').filter(Boolean)
  const rawValues = (raw.numberList || '').split(',').map(Number)
  // 合并同名
  const map = {}
  rawNames.forEach((n, i) => { map[n] = (map[n] || 0) + (rawValues[i] || 0) })
  const entries = Object.entries(map)
  return { names: entries.map(e => e[0]), values: entries.map(e => e[1]) }
}

// 入库趋势（近30天）
const inboundOpt = ref({})
async function loadInbound() {
  trendLoading.value = true
  try {
    const now = new Date()
    const d30 = new Date(now.getTime() - 30*86400000)
    const fmt = d => d.toISOString().slice(0,10)
    const [inb, outb] = await Promise.all([
      request.get('/report/top10/inbound', { params: { startDate: fmt(d30), endDate: fmt(now) } }),
      request.get('/report/top10/outbound', { params: { startDate: fmt(d30), endDate: fmt(now) } }),
    ])
    const i = parseReport(inb.data)
    const o = parseReport(outb.data)
    // 合并去重试剂名
    const allNames = [...new Set([...i.names, ...o.names])]
    const iMap = {}, oMap = {}
    i.names.forEach((n, idx) => { iMap[n] = i.values[idx] })
    o.names.forEach((n, idx) => { oMap[n] = o.values[idx] })
    inboundOpt.value = {
      tooltip: { trigger: 'axis' },
      legend: { data: ['入库', '出库'] },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category', data: allNames, axisLabel: { rotate: 30, fontSize: 11 } },
      yAxis: { type: 'value', name: '数量' },
      series: [
        { name: '入库', type: 'bar', data: allNames.map(n => iMap[n] || 0), itemStyle: { color: '#67c23a' } },
        { name: '出库', type: 'bar', data: allNames.map(n => oMap[n] || 0), itemStyle: { color: '#f56c6c' } },
      ],
    }
  } catch { /* */ }
  finally { trendLoading.value = false }
}

// 库存分类饼图
const pieOpt = ref({})
async function loadPie() {
  pieLoading.value = true
  try {
    const res = await request.get('/report/top10/high')
    const { names, values } = parseReport(res.data)
    pieOpt.value = {
      tooltip: { trigger: 'item' },
      series: [{
        type: 'pie', radius: ['40%', '70%'], center: ['50%', '50%'],
        data: names.map((n, i) => ({ name: n, value: values[i] })),
        label: { show: true, formatter: '{b}: {c}' }, labelLine: { show: false },
        emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.5)' } },
      }],
    }
  } catch { /* */ }
  finally { pieLoading.value = false }
}

onMounted(() => {
  loadStats()
  loadInbound()
  loadPie()
})
</script>

<template>
  <div class="page-container">
    <div class="page-header"><h2>工作台</h2></div>

    <!-- 统计卡片 -->
    <el-row :gutter="20" v-loading="statsLoading">
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-icon" style="background:#e6f7ff"><el-icon :size="28" color="#409eff"><Ticket /></el-icon></div>
          <div class="stat-info"><p class="stat-value">{{ stats.reagentCount }}</p><p class="stat-label">试剂种类</p></div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-icon" style="background:#f0f9eb"><el-icon :size="28" color="#67c23a"><Collection /></el-icon></div>
          <div class="stat-info"><p class="stat-value">{{ stats.batchCount }}</p><p class="stat-label">批次总数</p></div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-icon" style="background:#fef0e6"><el-icon :size="28" color="#e6a23c"><Warning /></el-icon></div>
          <div class="stat-info"><p class="stat-value">{{ stats.warningCount }}</p><p class="stat-label">预警提醒</p></div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-icon" style="background:#fef0f0"><el-icon :size="28" color="#f56c6c"><Clock /></el-icon></div>
          <div class="stat-info"><p class="stat-value">{{ stats.pendingAuditCount }}</p><p class="stat-label">待审核</p></div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 图表 -->
    <el-row :gutter="20" style="margin-top:20px">
      <el-col :span="14">
        <el-card v-loading="trendLoading">
          <template #header><span>近30天出入库排名</span></template>
          <v-chart :option="inboundOpt" autoresize style="height:340px" />
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card v-loading="pieLoading">
          <template #header><span>库存占比（Top10）</span></template>
          <v-chart :option="pieOpt" autoresize style="height:340px" />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.stat-card { --el-card-padding: 20px; }
.stat-card :deep(.el-card__body) { display:flex; align-items:center; gap:16px; }
.stat-icon { width:56px; height:56px; display:flex; align-items:center; justify-content:center; border-radius:8px; }
.stat-value { font-size:28px; font-weight:700; color:#303133; }
.stat-label { font-size:13px; color:#909399; margin-top:4px; }
</style>
