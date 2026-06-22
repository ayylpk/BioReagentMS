<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/utils/request'

const route = useRoute()

// ---------- 列表 ----------
const loading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const keyword = ref('')
const filterStatus = ref(null)
const filterReagentId = ref(null)

const batchStatusMap = { 0: '在库(未开封)', 1: '已开封', 2: '已用完', 3: '已过期' }

function batchStatusType(status) {
  return status === 0 ? 'success' : status === 1 ? 'warning' : status === 2 ? 'info' : 'danger'
}

async function loadList() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize: pageSize.value }
    if (keyword.value) params.keyword = keyword.value
    if (filterStatus.value !== null && filterStatus.value !== '') params.status = filterStatus.value
    if (filterReagentId.value) params.reagentId = filterReagentId.value
    const res = await request.get('/reagentBatches', { params })
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
  filterReagentId.value = null
  page.value = 1
  loadList()
}

// ---------- 新增 / 编辑弹窗 ----------
const dialogVisible = ref(false)
const dialogTitle = ref('新增批次')
const isEdit = ref(false)
const submitting = ref(false)
const formRef = ref(null)

const defaultForm = () => ({
  id: null,
  reagentId: null,
  batchNumber: '',
  productionDate: null,
  expiryDate: null,
  openedExpiryDays: null,
  openedDate: null,
  initialQuantity: 0,
  currentQuantity: 0,
  unitPrice: null,
  storageLocation: '',
  supplierId: null,
  status: 0,
  remark: '',
})

const form = ref(defaultForm())

const formRules = {
  reagentId: [{ required: true, message: '请选择试剂', trigger: 'change' }],
  batchNumber: [{ required: true, message: '请输入批号', trigger: 'blur' }],
}

function openAdd() {
  isEdit.value = false
  dialogTitle.value = '新增批次'
  form.value = defaultForm()
  dialogVisible.value = true
}

function openEdit(row) {
  isEdit.value = true
  dialogTitle.value = '编辑批次'
  form.value = {
    ...row,
    batchNumber: row.batchNumber || row.batchNo,
    storageLocation: row.storageLocation || row.location,
    currentQuantity: row.currentQuantity ?? row.remainingQuantity,
  }
  dialogVisible.value = true
}

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    if (isEdit.value) {
      await request.put('/reagentBatches', form.value)
      ElMessage.success('更新成功')
    } else {
      await request.post('/reagentBatches', form.value)
      ElMessage.success('新增成功')
    }
    dialogVisible.value = false
    loadList()
  } catch {
    // 拦截器已弹错误
  } finally {
    submitting.value = false
  }
}

// ---------- 删除 ----------
async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除批次「${row.batchNumber}」吗？`, '删除确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await request.delete(`/reagentBatches/${row.id}`)
    ElMessage.success('删除成功')
    loadList()
  } catch {
    // 取消或失败
  }
}

// ---------- 开封操作 ----------
async function handleOpen(row) {
  try {
    await ElMessageBox.confirm(`确定标记批次「${row.batchNumber}」为已开封吗？`, '开封确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'info',
    })
    await request.put('/reagentBatches', { ...row, status: 1, openedDate: new Date().toISOString().split('T')[0] })
    ElMessage.success('已标记为已开封')
    loadList()
  } catch {
    // cancelled
  }
}

onMounted(() => {
  if (route.query.reagentId) {
    filterReagentId.value = Number(route.query.reagentId)
  }
  loadList()
})
</script>

<template>
  <div class="page-container">
    <div class="page-header"><h2>批次管理</h2></div>

    <!-- 搜索栏 -->
    <div class="search-bar">
      <el-input v-model="keyword" placeholder="批号 / 试剂名" clearable style="width:200px" @keyup.enter="search" />
      <el-select v-model="filterStatus" placeholder="状态" clearable style="width:150px">
        <el-option v-for="(label, val) in batchStatusMap" :key="val" :label="label" :value="Number(val)" />
      </el-select>
      <el-input v-model="filterReagentId" placeholder="试剂ID" clearable style="width:120px" @keyup.enter="search" />
      <el-button type="primary" @click="search">搜索</el-button>
      <el-button @click="resetSearch">重置</el-button>
      <el-button type="success" @click="openAdd">新增批次</el-button>
    </div>

    <!-- 表格 -->
    <el-card>
      <el-table :data="list" v-loading="loading" stripe border>
        <el-table-column prop="batchNumber" label="批号" width="140" />
        <el-table-column prop="reagentName" label="试剂名称" minWidth="140" />
        <el-table-column prop="reagentId" label="试剂ID" width="80" />
        <el-table-column prop="productionDate" label="生产日期" width="110" />
        <el-table-column prop="expiryDate" label="失效日期" width="110" />
        <el-table-column prop="openedDate" label="开封日期" width="110" />
        <el-table-column prop="status" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="batchStatusType(row.status)" size="small">{{ batchStatusMap[row.status] || row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="currentQuantity" label="余量" width="80" />
        <el-table-column prop="initialQuantity" label="入库量" width="80" />
        <el-table-column prop="unitPrice" label="单价" width="80" />
        <el-table-column prop="storageLocation" label="存储位置" width="110" />
        <el-table-column prop="supplierId" label="供应商ID" width="100" />
        <el-table-column prop="remark" label="备注" minWidth="100" />
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button type="warning" link @click="openEdit(row)">编辑</el-button>
            <el-button v-if="row.status === 0" type="primary" link @click="handleOpen(row)">开封</el-button>
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

    <!-- 新增/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="680px" :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="110px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="试剂ID" prop="reagentId">
              <el-input-number v-model="form.reagentId" :min="1" style="width:100%" placeholder="关联试剂主键" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="批号" prop="batchNumber">
              <el-input v-model="form.batchNumber" placeholder="如 BN20260622" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="生产日期">
              <el-date-picker v-model="form.productionDate" type="date" placeholder="选择日期" style="width:100%" value-format="YYYY-MM-DD" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="失效日期">
              <el-date-picker v-model="form.expiryDate" type="date" placeholder="选择日期" style="width:100%" value-format="YYYY-MM-DD" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="开封后有效天数">
              <el-input-number v-model="form.openedExpiryDays" :min="0" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="开封日期">
              <el-date-picker v-model="form.openedDate" type="date" placeholder="未开封则留空" style="width:100%" value-format="YYYY-MM-DD" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="入库数量">
              <el-input-number v-model="form.initialQuantity" :min="0" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="当前余量">
              <el-input-number v-model="form.currentQuantity" :min="0" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="采购单价">
              <el-input-number v-model="form.unitPrice" :min="0" :precision="2" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="存储位置">
              <el-input v-model="form.storageLocation" placeholder="如 冰箱A-3层" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="供应商ID">
              <el-input-number v-model="form.supplierId" :min="1" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-select v-model="form.status" style="width:100%">
                <el-option v-for="(label, val) in batchStatusMap" :key="val" :label="label" :value="Number(val)" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注">
              <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="可选备注" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
