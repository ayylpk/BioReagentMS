<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import request from '@/utils/request'

const route = useRoute()
const router = useRouter()

const reagent = ref(null)
const batches = ref([])
const loading = ref(false)

const statusMap = { 0: '启用', 1: '禁用' }
const batchStatusMap = { 0: '在库(未开封)', 1: '已开封', 2: '已用完', 3: '已过期' }

async function loadDetail() {
  loading.value = true
  try {
    const [rRes, bRes] = await Promise.all([
      request.get(`/reagents/${route.params.id}`),
      request.get('/reagentBatches', { params: { reagentId: route.params.id } }),
    ])
    reagent.value = rRes.data
    batches.value = bRes.data?.records || bRes.data || []
  } catch {
    // silent
  } finally {
    loading.value = false
  }
}

function goBack() {
  router.push('/reagents')
}

function goBatchQuery(batchId) {
  router.push({ path: '/batches', query: { reagentId: route.params.id } })
}

function batchStatusType(status) {
  return status === 0 ? 'success' : status === 1 ? 'warning' : status === 2 ? 'info' : 'danger'
}

onMounted(() => loadDetail())
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="page-header">
      <h2>试剂详情</h2>
      <el-button @click="goBack">← 返回列表</el-button>
    </div>

    <!-- 基本信息 -->
    <el-card v-if="reagent" style="margin-bottom:20px">
      <template #header><span style="font-weight:600">基本信息</span></template>
      <el-descriptions :column="3" border>
        <el-descriptions-item label="试剂名称">{{ reagent.name }}</el-descriptions-item>
        <el-descriptions-item label="CAS号">{{ reagent.casNumber || '-' }}</el-descriptions-item>
        <el-descriptions-item label="分类ID">{{ reagent.categoryId || '-' }}</el-descriptions-item>
        <el-descriptions-item label="规格">{{ reagent.specification || '-' }}</el-descriptions-item>
        <el-descriptions-item label="纯度">{{ reagent.purity || '-' }}</el-descriptions-item>
        <el-descriptions-item label="总库存">{{ reagent.total ?? '-' }} {{ reagent.unit || '' }}</el-descriptions-item>
        <el-descriptions-item label="单位">{{ reagent.unit || '-' }}</el-descriptions-item>
        <el-descriptions-item label="存储条件">{{ reagent.storageCondition || '-' }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="reagent.status === 0 ? 'success' : 'info'" size="small">{{ statusMap[reagent.status] ?? reagent.status }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="安全库存阈值">{{ reagent.safetyStockThreshold ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="预警提前天数">{{ reagent.warningAdvanceDays ?? '-' }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <!-- 关联批次 -->
    <el-card>
      <template #header><span style="font-weight:600">关联批次</span></template>
      <el-table :data="batches" stripe border @row-click="goBatchQuery" style="cursor:pointer">
        <el-table-column prop="batchNumber" label="批号" width="140" />
        <el-table-column prop="productionDate" label="生产日期" width="110" />
        <el-table-column prop="expiryDate" label="失效日期" width="110" />
        <el-table-column prop="status" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="batchStatusType(row.status)" size="small">{{ batchStatusMap[row.status] || row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="openedDate" label="开封日期" width="110" />
        <el-table-column prop="currentQuantity" label="当前余量" width="90" />
        <el-table-column prop="initialQuantity" label="入库量" width="80" />
        <el-table-column prop="unitPrice" label="单价" width="80" />
        <el-table-column prop="storageLocation" label="存储位置" />
        <el-table-column prop="supplierId" label="供应商ID" width="100" />
        <el-table-column prop="remark" label="备注" minWidth="120" />
        <el-table-column prop="createTime" label="入库时间" width="160" />
      </el-table>
      <el-empty v-if="!batches.length" description="暂无批次记录" />
    </el-card>
  </div>
</template>
