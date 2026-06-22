<script setup>
import { ref, onMounted } from 'vue'
import request from '@/utils/request'

const loading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const filterModule = ref('')
const filterAction = ref('')

const moduleOptions = ['试剂', '批次', '入库', '出库']

async function loadList() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize: pageSize.value }
    if (filterModule.value) params.module = filterModule.value
    if (filterAction.value) params.action = filterAction.value
    const res = await request.get('/operation/page', { params })
    list.value = res.data?.records || []
    total.value = res.data?.total || 0
  } catch { list.value = [] }
  finally { loading.value = false }
}

function search() {
  page.value = 1
  loadList()
}

function resetSearch() {
  filterModule.value = ''
  filterAction.value = ''
  page.value = 1
  loadList()
}

onMounted(() => loadList())
</script>

<template>
  <div class="page-container">
    <div class="page-header"><h2>操作日志</h2></div>

    <div class="search-bar">
      <el-select v-model="filterModule" placeholder="模块" clearable style="width:140px">
        <el-option v-for="m in moduleOptions" :key="m" :label="m" :value="m" />
      </el-select>
      <el-input v-model="filterAction" placeholder="操作（新增、删除、修改、审批）" clearable style="width:200px" @keyup.enter="search" />
      <el-button type="primary" @click="search">搜索</el-button>
      <el-button @click="resetSearch">重置</el-button>
    </div>

    <el-card>
      <el-table :data="list" v-loading="loading" stripe border>
        <el-table-column prop="operatorName" label="操作人" width="100" />
        <el-table-column prop="module" label="模块" width="80" />
        <el-table-column prop="action" label="操作" width="80" />
        <el-table-column prop="targetId" label="目标" width="140" show-overflow-tooltip />
        <el-table-column prop="detail" label="详情" minWidth="240" show-overflow-tooltip />
        <el-table-column prop="createTime" label="时间" width="170" />
      </el-table>
    </el-card>

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
