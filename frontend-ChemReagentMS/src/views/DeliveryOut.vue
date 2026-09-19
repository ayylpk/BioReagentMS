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
  quantity: 1,
  remark: '',
})

const form = ref(defaultForm())

// ⚠️ 这里**不应该**有"选批次"这一项：出库不手选批次。
// 扣哪一批由后端在审批时按效期自动决定（FEFO：先到期的先出，见 ReagentBatchMapper.listAvailableByReagentId
// 的 ORDER BY expiry_date ASC），申请单只表达"要哪个试剂、要多少"。
// 曾经这里挂着一条必填的 batchId 规则，而表单里并没有对应控件 —— 于是提交永远被校验拦住、
// 整个新建出库申请功能不可用。那是**规则写错**，不是控件缺失（补控件就把 FEFO 架空了）。
const formRules = {
  reagentId: [{ required: true, message: '请选择试剂', trigger: 'change' }],
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
}

// （原此处是"批次下拉"整套逻辑：batchOptions / batchLoading / loadBatchOptions / onBatchSelect
//   以及监听试剂变化去加载批次。已删除 —— 出库不手选批次，FEFO 由后端在审批时算。
//   那一整套从未被模板渲染过，是死代码，却容易让人以为"批次是要手选的"。）

function openAdd() {
  form.value = defaultForm()
  reagentOptions.value = []
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
