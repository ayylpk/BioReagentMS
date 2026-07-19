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
const keyword = ref('')

const statusMap = { '-1': '已取消', '0': '待审核', '1': '已通过', '2': '已拒绝' }
const statusTypeMap = { '-1': 'info', '0': 'warning', '1': 'success', '2': 'danger' }

async function loadList() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize: pageSize.value }
    if (keyword.value) params.reagentName = keyword.value
    const res = await request.get('/outboundOrderAudit', { params })
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

// ---------- 通过 ----------
async function handleApprove(row) {
  try {
    await ElMessageBox.confirm(
      `确定通过出库单「${row.orderNumber}」吗？将扣减批次库存。`,
      '审核通过',
      { confirmButtonText: '确定通过', cancelButtonText: '取消', type: 'warning' },
    )
    await request.put('/outboundOrderAudit/agree', null, {
      params: { id: row.id, reagentId: row.reagentId, reagentName: row.reagentName, quantity: row.quantity },
    })
    ElMessage.success('已通过')
    loadList()
  } catch {
    // 取消或失败
  }
}

// ---------- 拒绝 ----------
const rejectVisible = ref(false)
const rejectForm = ref({ id: null, orderNumber: '', reason: '' })
const rejectSubmitting = ref(false)

function openReject(row) {
  rejectForm.value = { id: row.id, orderNumber: row.orderNumber, reason: '' }
  rejectVisible.value = true
}

async function handleReject() {
  if (!rejectForm.value.reason.trim()) {
    ElMessage.warning('请填写拒绝原因')
    return
  }
  rejectSubmitting.value = true
  try {
    await request.put('/outboundOrderAudit/reject', null, {
      params: { id: rejectForm.value.id, rejectionReason: rejectForm.value.reason },
    })
    ElMessage.success('已拒绝')
    rejectVisible.value = false
    loadList()
  } catch {
    // 拦截器已弹错误
  } finally {
    rejectSubmitting.value = false
  }
}

onMounted(() => loadList())
</script>

<template>
  <div class="page-container">
    <div class="page-header"><h2>出库审核</h2></div>

    <!-- 搜索栏 -->
    <div class="search-bar">
      <el-input v-model="keyword" placeholder="试剂名称 / 单号" clearable style="width:200px" @keyup.enter="search" />
      <el-button type="primary" @click="search">搜索</el-button>
    </div>

    <!-- 表格 -->
    <el-card>
      <el-table :data="list" v-loading="loading" stripe border>
        <el-table-column prop="orderNumber" label="出库单号" width="160" />
        <el-table-column prop="reagentName" label="试剂名称" minWidth="140" />
        <el-table-column prop="quantity" label="出库数量" width="90" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusTypeMap[row.status] || 'info'" size="small">{{ statusMap[row.status] ?? row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="operatorName" label="申请人" width="100" />
        <el-table-column prop="deliveryTime" label="申请时间" width="170" />
        <el-table-column prop="remark" label="备注" minWidth="100" />
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <template v-if="row.status === 0">
              <el-button type="success" link @click="handleApprove(row)">通过</el-button>
              <el-button type="danger" link @click="openReject(row)">拒绝</el-button>
            </template>
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

    <!-- 拒绝原因弹窗 -->
    <el-dialog v-model="rejectVisible" title="拒绝出库申请" width="480px" :close-on-click-modal="false">
      <p style="margin-bottom:12px;color:#606266">
        出库单号：<strong>{{ rejectForm.orderNumber }}</strong>
      </p>
      <el-input
        v-model="rejectForm.reason"
        type="textarea"
        :rows="3"
        placeholder="请填写拒绝原因（必填）"
      />
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <el-button type="danger" :loading="rejectSubmitting" @click="handleReject">确认拒绝</el-button>
      </template>
    </el-dialog>
  </div>
</template>
