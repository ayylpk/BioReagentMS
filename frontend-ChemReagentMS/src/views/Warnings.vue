<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/utils/request'

// ---------- 列表 ----------
const loading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const filterStatus = ref(null)

const warningTypeMap = { 'EXPIRY': '临期', 'SHORTAGE': '库存不足' }

function warningLabel(row) {
  if (row.warningType === 'SHORTAGE' && row.currentStock === 0) return '库存为0'
  return warningTypeMap[row.warningType] || row.warningType
}

function warningTagType(row) {
  if (row.warningType === 'EXPIRY') return 'danger'
  if (row.currentStock === 0) return 'danger'
  return 'warning'
}
const statusMap = { 0: '未处理', 1: '已处理' }

async function loadList() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize: pageSize.value }
    if (filterStatus.value !== null && filterStatus.value !== '') params.status = filterStatus.value
    const res = await request.get('/warning/list', { params })
    list.value = res.data?.records || []
    total.value = res.data?.total || 0
  } catch {
    list.value = []
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  loadList()
}

// ---------- 标记已处理 ----------
async function handleResolve(row) {
  try {
    await ElMessageBox.confirm(`确定标记预警「${row.reagentName}」为已处理吗？`, '处理确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'info',
    })
    await request.put(`/warning/${row.id}/resolve`)
    ElMessage.success('已标记为已处理')
    loadList()
  } catch {
    // 取消或失败
  }
}

onMounted(() => loadList())
</script>

<template>
  <div class="page-container">
    <div class="page-header"><h2>预警管理</h2></div>

    <!-- 搜索栏 -->
    <div class="search-bar">
      <el-select v-model="filterStatus" placeholder="处理状态" clearable style="width:150px" @change="search">
        <el-option v-for="(label, val) in statusMap" :key="val" :label="label" :value="Number(val)" />
      </el-select>
      <el-button type="primary" @click="search">筛选</el-button>
    </div>

    <!-- 表格 -->
    <el-card>
      <el-table :data="list" v-loading="loading" stripe border>
        <el-table-column prop="warningType" label="预警类型" width="110">
          <template #default="{ row }">
            <el-tag :type="warningTagType(row)" size="small">{{ warningLabel(row) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reagentName" label="关联试剂" minWidth="140" />
        <el-table-column prop="reagentBatch" label="关联批次" width="140" />
        <el-table-column prop="currentStock" label="当前库存" width="85" />
        <el-table-column prop="safetyStockThreshold" label="安全阈值" width="85" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 0 ? 'danger' : 'success'" size="small">
              {{ statusMap[row.status] ?? row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="triggerTime" label="触发时间" width="170" />
        <el-table-column prop="resolveTime" label="处理时间" width="170" />
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 0"
              type="primary"
              link
              @click="handleResolve(row)"
            >处理</el-button>
            <span v-else style="color:#909399">——</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 分页 -->
    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :total="total"
      layout="total, prev, pager, next, sizes"
      style="margin-top:16px; justify-content:flex-end"
      @change="loadList"
    />
  </div>
</template>
