<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/utils/request'

const router = useRouter()

// ---------- 列表 ----------
const loading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const keyword = ref('')
const filterCategoryId = ref(null)
const categories = ref([])

const statusMap = { 0: '启用', 1: '禁用' }

const columns = [
  { prop: 'name', label: '试剂名称', minWidth: 140 },
  { prop: 'casNumber', label: 'CAS号', width: 140 },
  { prop: 'specification', label: '规格', width: 100 },
  { prop: 'purity', label: '纯度', width: 90 },
  { prop: 'total', label: '总库存', width: 80 },
  { prop: 'safetyStockThreshold', label: '安全阈值', width: 85 },
  { prop: 'unit', label: '单位', width: 70 },
  { prop: 'storageCondition', label: '存储条件', width: 110 },
]

async function loadList() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize: pageSize.value }
    if (keyword.value) params.keyword = keyword.value
    if (filterCategoryId.value) params.categoryId = filterCategoryId.value
    const res = await request.get('/reagents/', { params })
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
  filterCategoryId.value = null
  page.value = 1
  loadList()
}

function goDetail(id) {
  router.push(`/reagents/${id}`)
}

function goReagentBatches(id) {
  router.push({ path: '/batches', query: { reagentId: id } })
}

// ---------- 新增 / 编辑弹窗 ----------
const dialogVisible = ref(false)
const dialogTitle = ref('新增试剂')
const isEdit = ref(false)
const submitting = ref(false)
const formRef = ref(null)

const defaultForm = () => ({
  id: null,
  name: '',
  casNumber: '',
  specification: '',
  purity: '',
  categoryId: null,
  total: null,
  unit: '',
  storageCondition: '',
  safetyStockThreshold: null,
  warningAdvanceDays: null,
  status: 0,
})

const form = ref(defaultForm())

const formRules = {
  name: [{ required: true, message: '请输入试剂名称', trigger: 'blur' }],
}

function openAdd() {
  isEdit.value = false
  dialogTitle.value = '新增试剂'
  form.value = defaultForm()
  dialogVisible.value = true
}

function openEdit(row) {
  isEdit.value = true
  dialogTitle.value = '编辑试剂'
  form.value = { ...row }
  dialogVisible.value = true
}

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    if (isEdit.value) {
      await request.put('/reagents/', form.value)
      ElMessage.success('更新成功')
    } else {
      await request.post('/reagents/', form.value)
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
    await ElMessageBox.confirm(`确定删除试剂「${row.name}」吗？删除后不可恢复。`, '删除确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await request.delete('/reagents/', { params: { ids: [row.id] } })
    ElMessage.success('删除成功')
    loadList()
  } catch {
    // 取消或失败
  }
}

// ---------- 分类列表（下拉用） ----------
async function loadCategories() {
  try {
    categories.value = [
      { id: 1, name: '无机试剂' },
      { id: 2, name: '有机试剂' },
      { id: 3, name: '生化试剂' },
      { id: 4, name: '分析试剂' },
      { id: 5, name: '标准品' },
    ]
  } catch {

  }
}

onMounted(() => {
  loadCategories()
  loadList()
})
</script>

<template>
  <div class="page-container">
    <div class="page-header"><h2>试剂管理</h2></div>

    <!-- 搜索栏 -->
    <div class="search-bar">
      <el-input v-model="keyword" placeholder="名称 / CAS号" clearable style="width:200px" @keyup.enter="search" />
      <el-select v-model="filterCategoryId" placeholder="分类" clearable style="width:150px">
        <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <el-button type="primary" @click="search">搜索</el-button>
      <el-button @click="resetSearch">重置</el-button>
      <el-button type="success" @click="openAdd">新增试剂</el-button>
    </div>

    <!-- 表格 -->
    <el-card>
      <el-table :data="list" v-loading="loading" stripe border @row-click="(row) => goReagentBatches(row.id)" style="cursor:pointer">
        <el-table-column v-for="col in columns" :key="col.prop" v-bind="col" />
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 0 ? 'success' : 'info'" size="small">{{ statusMap[row.status] || row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click.stop="goDetail(row.id)">详情</el-button>
            <el-button type="warning" link @click.stop="openEdit(row)">编辑</el-button>
            <el-button type="danger" link @click.stop="handleDelete(row)">删除</el-button>
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
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="640px" :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="120px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="试剂名称" prop="name">
              <el-input v-model="form.name" placeholder="如 氯化钠" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="CAS号">
              <el-input v-model="form.casNumber" placeholder="如 7647-14-5" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="规格">
              <el-input v-model="form.specification" placeholder="如 500g/瓶" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="纯度">
              <el-input v-model="form.purity" placeholder="如 99.5%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="分类">
              <el-select v-model="form.categoryId" placeholder="选择分类" style="width:100%">
                <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="单位">
              <el-input v-model="form.unit" placeholder="如 瓶、g、mL" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="初始库存">
              <el-input-number v-model="form.total" :min="0" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="存储条件">
              <el-input v-model="form.storageCondition" placeholder="如 2-8°C避光" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="安全库存阈值">
              <el-input-number v-model="form.safetyStockThreshold" :min="0" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="预警提前天数">
              <el-input-number v-model="form.warningAdvanceDays" :min="0" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-radio-group v-model="form.status">
                <el-radio :value="0">启用</el-radio>
                <el-radio :value="1">禁用</el-radio>
              </el-radio-group>
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
