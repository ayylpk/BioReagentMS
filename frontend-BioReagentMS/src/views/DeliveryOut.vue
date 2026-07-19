<script setup>
import { ref, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/utils/request'

// ---------- 列表 ----------
const loading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const keyword = ref('')
const filterStatus = ref(null)

const statusMap = { '-1': '已取消', '0': '待审核', '1': '已通过', '2': '已拒绝' }
const statusTypeMap = { '-1': 'info', '0': 'warning', '1': 'success', '2': 'danger' }

async function loadList() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize: pageSize.value }
    if (keyword.value) params.reagentName = keyword.value
    if (filterStatus.value !== null && filterStatus.value !== '') params.status = filterStatus.value
    const res = await request.get('/deliveryOrder', { params })
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

function resetSearch() {
  keyword.value = ''
  filterStatus.value = null
  page.value = 1
  loadList()
}

// ---------- 新建申请弹窗 ----------
const dialogVisible = ref(false)
const submitting = ref(false)
const formRef = ref(null)

const defaultForm = () => ({
  orderNumber: 'CK' + Date.now(),
  reagentId: null,
  reagentName: '',
  batchId: null,
  batchNumber: '',
  quantity: 1,
  remark: '',
})

const form = ref(defaultForm())

const formRules = {
  reagentId: [{ required: true, message: '请选择试剂', trigger: 'change' }],
  batchId: [{ required: true, message: '请选择批次', trigger: 'change' }],
  quantity: [{ required: true, message: '请输入数量', trigger: 'blur' }],
}

// 试剂下拉
const reagentOptions = ref([])
const reagentLoading = ref(false)

async function loadReagentOptions(query) {
  reagentLoading.value = true
  try {
    const res = await request.get('/reagents/', { params: { keyword: query || '', page: 1, pageSize: 50, status: 0 } })
    reagentOptions.value = (res.data?.records || []).map(r => ({ label: r.name, value: r.id }))
  } catch {
    reagentOptions.value = []
  } finally {
    reagentLoading.value = false
  }
}

function onReagentSelect(val) {
  const r = reagentOptions.value.find(o => o.value === val)
  form.value.reagentName = r ? r.label : ''
  // 重置批次选择
  form.value.batchId = null
  form.value.batchNumber = ''
  batchOptions.value = []
}

// 批次下拉（依赖试剂选择）
const batchOptions = ref([])
const batchLoading = ref(false)

async function loadBatchOptions(reagentId) {
  if (!reagentId) { batchOptions.value = []; return }
  batchLoading.value = true
  try {
    const res = await request.get('/reagentBatches', { params: { reagentId, page: 1, pageSize: 100 } })
    // 只显示未用完的批次
    const records = res.data?.records || res.data || []
    batchOptions.value = records
      .filter(b => b.status !== 2 && b.status !== 3) // 排除已用完和已过期
      .map(b => ({ label: `${b.batchNumber} (余量:${b.currentQuantity ?? b.initialQuantity})`, value: b.id, batchNumber: b.batchNumber, remaining: b.currentQuantity ?? b.initialQuantity }))
  } catch {
    batchOptions.value = []
  } finally {
    batchLoading.value = false
  }
}

function onBatchSelect(val) {
  const b = batchOptions.value.find(o => o.value === val)
  form.value.batchNumber = b ? b.batchNumber : ''
}

// 监听试剂变化 → 加载批次
watch(() => form.value.reagentId, (newVal) => {
  loadBatchOptions(newVal)
})

function openAdd() {
  form.value = defaultForm()
  reagentOptions.value = []
  batchOptions.value = []
  dialogVisible.value = true
}

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    await request.post('/deliveryOrder', form.value)
    ElMessage.success('出库申请已提交')
    dialogVisible.value = false
    loadList()
  } catch {
    // 拦截器已弹错误
  } finally {
    submitting.value = false
  }
}

// ---------- 取消申请 ----------
async function handleCancel(row) {
  try {
    await ElMessageBox.confirm(`确定取消出库单「${row.orderNumber}」吗？`, '取消确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await request.put('/deliveryOrder', { ...row, status: -1 })
    ElMessage.success('已取消')
    loadList()
  } catch {
    // 取消或失败
  }
}

// ---------- 删除 ----------
async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除出库单「${row.orderNumber}」吗？`, '删除确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await request.delete(`/deliveryOrder/${row.id}`)
    ElMessage.success('删除成功')
    loadList()
  } catch {
    // 取消或失败
  }
}

onMounted(() => {
  loadList()
  loadReagentOptions()
})
</script>

<template>
  <div class="page-container">
    <div class="page-header"><h2>出库申请</h2></div>

    <!-- 搜索栏 -->
    <div class="search-bar">
      <el-input v-model="keyword" placeholder="试剂名称 / 单号" clearable style="width:200px" @keyup.enter="search" />
      <el-select v-model="filterStatus" placeholder="状态" clearable style="width:140px">
        <el-option v-for="(label, val) in statusMap" :key="val" :label="label" :value="Number(val)" />
      </el-select>
      <el-button type="primary" @click="search">搜索</el-button>
      <el-button @click="resetSearch">重置</el-button>
      <el-button type="success" @click="openAdd">新建申请</el-button>
    </div>

    <!-- 表格 -->
    <el-card>
      <el-table :data="list" v-loading="loading" stripe border>
        <el-table-column prop="orderNumber" label="出库单号" width="160" />
        <el-table-column prop="reagentName" label="试剂名称" minWidth="100" />
        <el-table-column prop="batchNumber" label="出库批次" minWidth="140" />
        <el-table-column prop="quantity" label="数量" width="80" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusTypeMap[row.status] || 'info'" size="small">{{ statusMap[row.status] ?? row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="operatorName" label="申请人" width="100" />
        <el-table-column prop="deliveryTime" label="出库时间" width="170" />
        <el-table-column prop="approverName" label="审核人" width="100" />
        <el-table-column prop="remark" label="备注" minWidth="100" />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 0" type="warning" link @click="handleCancel(row)">取消</el-button>
            <el-button type="danger" link @click="handleDelete(row)">删除</el-button>
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

    <!-- 新建申请弹窗 -->
    <el-dialog v-model="dialogVisible" title="新建出库申请" width="560px" :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="100px">
        <el-form-item label="出库单号">
          <el-input v-model="form.orderNumber" placeholder="自动生成" disabled />
        </el-form-item>
        <el-form-item label="试剂" prop="reagentId">
          <el-select
            v-model="form.reagentId"
            filterable
            remote
            :remote-method="loadReagentOptions"
            :loading="reagentLoading"
            placeholder="搜索并选择试剂"
            style="width:100%"
            @change="onReagentSelect"
          >
            <el-option v-for="r in reagentOptions" :key="r.value" :label="r.label" :value="r.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="出库数量" prop="quantity">
          <el-input-number v-model="form.quantity" :min="1" style="width:100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">提交申请</el-button>
      </template>
    </el-dialog>
  </div>
</template>
