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

const roleMap = { 0: '系统管理员', 1: '仓库管理员', 2: '普通实验人员', 3: '采购人员', 4: '课题负责人' }
const statusMap = { 0: '禁用', 1: '启用' }

const columns = [
  { prop: 'username', label: '用户名', width: 120 },
  { prop: 'name', label: '姓名', width: 100 },
  { prop: 'roleName', label: '角色', width: 130 },
  { prop: 'email', label: '邮箱', width: 180 },
  { prop: 'phone', label: '手机', width: 130 },
  { prop: 'status', label: '状态', width: 80 },
]

async function loadList() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize: pageSize.value }
    if (keyword.value) { params.username = keyword.value; params.name = keyword.value }
    const res = await request.get('/users/', { params })
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
  page.value = 1
  loadList()
}

// ---------- 新增/编辑弹窗 ----------
const dialogVisible = ref(false)
const dialogTitle = ref('新增用户')
const isEdit = ref(false)
const submitting = ref(false)
const formRef = ref(null)

const defaultForm = () => ({
  id: null,
  username: '',
  password: '',
  role: 2,
  roleName: '',
  name: '',
  email: '',
  phone: '',
  status: 1,
})

const form = ref(defaultForm())

const formRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
}

function onRoleChange(val) {
  form.value.roleName = roleMap[val] || ''
}

function openAdd() {
  isEdit.value = false
  dialogTitle.value = '新增用户'
  form.value = defaultForm()
  dialogVisible.value = true
}

function openEdit(row) {
  isEdit.value = true
  dialogTitle.value = '编辑用户'
  form.value = { ...row }
  dialogVisible.value = true
}

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    if (isEdit.value) {
      await request.put('/users/', form.value)
      ElMessage.success('更新成功')
    } else {
      if (!form.value.password) {
        ElMessage.warning('请输入密码')
        submitting.value = false
        return
      }
      await request.post('/users/', form.value)
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

// ---------- 切换启用/禁用 ----------
async function handleToggleStatus(row) {
  const newStatus = row.status === 1 ? 0 : 1
  const label = newStatus === 1 ? '启用' : '禁用'
  try {
    await ElMessageBox.confirm(`确定${label}用户「${row.username}」吗？`, '操作确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await request.put('/users/', { ...row, status: newStatus })
    ElMessage.success(`已${label}`)
    loadList()
  } catch {
    // 取消或失败
  }
}

// ---------- 删除 ----------
async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除用户「${row.username}」吗？`, '删除确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await request.delete('/users/', { params: { id: row.id } })
    ElMessage.success('删除成功')
    loadList()
  } catch {
    // 取消或失败
  }
}

onMounted(() => loadList())
</script>

<template>
  <div class="page-container">
    <div class="page-header"><h2>用户管理</h2></div>

    <!-- 搜索栏 -->
    <div class="search-bar">
      <el-input v-model="keyword" placeholder="用户名 / 姓名" clearable style="width:200px" @keyup.enter="search" />
      <el-button type="primary" @click="search">搜索</el-button>
      <el-button @click="resetSearch">重置</el-button>
      <el-button type="success" @click="openAdd">新增用户</el-button>
    </div>

    <!-- 表格 -->
    <el-card>
      <el-table :data="list" v-loading="loading" stripe border>
        <el-table-column v-for="col in columns" :key="col.prop" v-bind="col">
          <template v-if="col.prop === 'roleName'" #default="{ row }">{{ row.roleName || roleMap[row.role] }}</template>
          <template v-else-if="col.prop === 'status'" #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'" size="small">{{ statusMap[row.status] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button type="warning" link @click="openEdit(row)">编辑</el-button>
            <el-button
              :type="row.status === 1 ? 'danger' : 'success'"
              link
              @click="handleToggleStatus(row)"
            >{{ row.status === 1 ? '禁用' : '启用' }}</el-button>
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
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="540px" :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="80px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="用户名" prop="username">
              <el-input v-model="form.username" :disabled="isEdit" placeholder="登录用户名" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="姓名" prop="name">
              <el-input v-model="form.name" placeholder="真实姓名" />
            </el-form-item>
          </el-col>
          <el-col v-if="!isEdit" :span="12">
            <el-form-item label="密码">
              <el-input v-model="form.password" type="password" placeholder="登录密码" show-password />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="角色" prop="role">
              <el-select v-model="form.role" style="width:100%" @change="onRoleChange">
                <el-option v-for="(label, val) in roleMap" :key="val" :label="label" :value="Number(val)" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="邮箱">
              <el-input v-model="form.email" placeholder="电子邮箱" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="手机">
              <el-input v-model="form.phone" placeholder="手机号码" />
            </el-form-item>
          </el-col>
          <el-col v-if="isEdit" :span="12">
            <el-form-item label="状态">
              <el-radio-group v-model="form.status">
                <el-radio :value="1">启用</el-radio>
                <el-radio :value="0">禁用</el-radio>
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
