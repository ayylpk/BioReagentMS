<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/utils/request'
import axios from 'axios'

// ---------- 列表 ----------
const loading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const keyword = ref('')

async function loadList() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize: pageSize.value }
    if (keyword.value) params.reagentName = keyword.value
    const res = await request.get('/webSearch', { params })
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

// ---------- 新增弹窗 ----------
const dialogVisible = ref(false)
const submitting = ref(false)
const formRef = ref(null)

const defaultForm = () => ({ reagentName: '', casNumber: '', content: '' })
const form = ref(defaultForm())

const formRules = {
  reagentName: [{ required: true, message: '请输入试剂名称', trigger: 'blur' }],
  content: [{ required: true, message: '请输入检索内容', trigger: 'blur' }],
}

function openAdd() {
  form.value = defaultForm()
  dialogVisible.value = true
}

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    await request.post('/webSearch', form.value)
    ElMessage.success('新增成功')
    dialogVisible.value = false
    loadList()
  } catch {
    // error handled by interceptor
  } finally {
    submitting.value = false
  }
}

// ---------- 删除 ----------
async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(
      `确定删除「${row.reagentName}」的检索记录吗？`,
      '确认删除',
      { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' },
    )
    await request.delete(`/webSearch/${row.id}`)
    ElMessage.success('删除成功')
    loadList()
  } catch {
    // 取消或失败
  }
}

// ---------- 确认存入知识库 ----------
const confirming = ref(null)  // 正在确认的行 id

async function handleConfirm(row) {
  try {
    await ElMessageBox.confirm(
      `确定将「${row.reagentName}」的检索内容存入 Chroma 知识库吗？`,
      '确认存入',
      { confirmButtonText: '确定', cancelButtonText: '取消', type: 'info' },
    )
    confirming.value = row.id
    // 1. 存入 Chroma
    await axios.post('/search/webSearch/confirm', {
      reagent_name: row.reagentName,
      cas_number: row.casNumber || '',
      content: row.content,
    })
    // 2. 从 MySQL 删除
    await axios.delete(`/search/webSearch/${row.id}`)
    ElMessage.success('已存入知识库')
    loadList()
  } catch {
    // 取消或失败
  } finally {
    confirming.value = null
  }
}

// ---------- 查看详情 ----------
const detailVisible = ref(false)
const detail = ref({})

function openDetail(row) {
  detail.value = row
  detailVisible.value = true
}

onMounted(() => loadList())
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <h2>联网检索结果</h2>
    </div>

    <!-- 搜索栏 -->
    <div class="search-bar">
      <el-input v-model="keyword" placeholder="试剂名称" clearable style="width:220px" @keyup.enter="search" />
      <el-button type="primary" @click="search">搜索</el-button>
      <el-button type="success" @click="openAdd">新增记录</el-button>
    </div>

    <!-- 表格 -->
    <el-card>
      <el-table :data="list" v-loading="loading" stripe border>
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column prop="reagentName" label="试剂名称" minWidth="140" />
        <el-table-column prop="casNumber" label="CAS号" width="140" />
        <el-table-column prop="createTime" label="创建时间" width="170" />
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openDetail(row)">详情</el-button>
            <el-button type="success" link :loading="confirming === row.id" @click="handleConfirm(row)">确定</el-button>
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

    <!-- 新增弹窗 -->
    <el-dialog v-model="dialogVisible" title="新增检索记录" width="520px" :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="90px">
        <el-form-item label="试剂名称" prop="reagentName">
          <el-input v-model="form.reagentName" placeholder="如：过氧化氢" />
        </el-form-item>
        <el-form-item label="CAS号" prop="casNumber">
          <el-input v-model="form.casNumber" placeholder="如：7722-84-1" />
        </el-form-item>
        <el-form-item label="检索内容" prop="content">
          <el-input v-model="form.content" type="textarea" :rows="6" placeholder="粘贴联网检索结果内容" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 详情弹窗 -->
    <el-dialog v-model="detailVisible" title="检索内容详情" width="600px">
      <p><strong>试剂名称：</strong>{{ detail.reagentName }}</p>
      <p><strong>CAS号：</strong>{{ detail.casNumber || '无' }}</p>
      <p><strong>创建时间：</strong>{{ detail.createTime }}</p>
      <div style="margin-top:12px">
        <strong>检索内容：</strong>
        <div style="white-space:pre-wrap; background:#f5f7fa; padding:12px; border-radius:4px; margin-top:6px; max-height:300px; overflow-y:auto">
          {{ detail.content }}
        </div>
      </div>
    </el-dialog>
  </div>
</template>
