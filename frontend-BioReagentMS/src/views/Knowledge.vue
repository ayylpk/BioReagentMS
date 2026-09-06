<script setup>
// 知识库管理 —— 语料的人工进料口（只有上传/拖拽，不做爬虫入口；爬虫将来直连 /ingest API）
// 交互模型：文件逐个 POST /ingest/upload → 服务端串行队列解析 → 本页轮询台账(ingest_log)看状态翻转
// 后端是 Hono :8123（vite proxy /ingest），不走 Java 的 {code,msg} 包装，所以用裸 axios 而非 @/utils/request
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from 'axios'

// ---------- 白名单（与 tsAgent routes/ingest.ts 的 ALLOW_EXT 同步改） ----------
const ALLOW_EXT = ['pdf', 'docx', 'xlsx', 'txt', 'md', 'csv']
const ACCEPT_HINT = `支持 ${ALLOW_EXT.join(' / ')}，单文件 ≤50MB；可拖文件或整个文件夹（自动递归取文档）`
const extOf = (name) => (name.split('.').pop() || '').toLowerCase()

// ---------- 状态字典（台账五态：queued 是 API 预写，其余四个由 pipeline 落账） ----------
const STATUS = {
  queued: { label: '排队中', tag: 'info' },
  done: { label: '已入库', tag: 'success' },
  review: { label: '待人审', tag: 'warning' },
  quarantined: { label: '隔离', tag: 'primary' },
  failed: { label: '失败', tag: 'danger' },
}
const fmtCost = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)
const fmtTime = (v) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—')

// ---------- 上传（逐个传，进度条可见；文件夹递归只在拖拽时需要，input[webkitdirectory] 浏览器已拍平） ----------
const fileInput = ref(null)
const dirInput = ref(null)
const dragOver = ref(false)
const uploading = ref(false)
const progress = ref({ done: 0, total: 0 })

/** 拖进来的 FileSystemEntry 递归展开成 File 列表（readEntries 每批最多回 100 条，要循环读到空） */
function collectEntry(entry) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file(
        (f) => resolve([f]),
        () => resolve([]),
      )
    } else if (entry.isDirectory) {
      const out = []
      const reader = entry.createReader()
      const readBatch = () =>
        reader.readEntries(
          async (batch) => {
            if (!batch.length) return resolve(out)
            for (const e of batch) out.push(...(await collectEntry(e)))
            readBatch()
          },
          () => resolve(out),
        )
      readBatch()
    } else resolve([])
  })
}

async function handleFiles(rawFiles) {
  // 白名单前端先过一遍（后端还有硬校验），挡掉 .DS_Store / 缩略图 / 老 .doc 之类噪音
  let skipped = 0
  const kept = []
  for (const f of rawFiles) {
    if (ALLOW_EXT.includes(extOf(f.name))) kept.push(f)
    else skipped++
  }
  if (!kept.length) {
    ElMessage.warning(`没有符合白名单的文件（${ALLOW_EXT.join('/')}）${skipped ? `，跳过 ${skipped} 个` : ''}`)
    return
  }
  if (skipped) ElMessage.info(`跳过 ${skipped} 个不支持的文件，上传剩余 ${kept.length} 个`)

  uploading.value = true
  progress.value = { done: 0, total: kept.length }
  let queuedN = 0
  let failN = 0
  // 铁律：一个一个传（用户拍板），失败不中断整批（旁路化，同 pipeline 姿势）
  for (const f of kept) {
    const fd = new FormData()
    fd.append('file', f)
    try {
      const res = await axios.post('/ingest/upload', fd)
      queuedN += res.data.accepted?.length || 0
      failN += res.data.rejected?.length || 0
    } catch {
      failN++
    }
    progress.value.done++
  }
  uploading.value = false
  if (queuedN) ElMessage.success(`已入队 ${queuedN} 份，正在后台解析（排队中→状态会自动翻转）`)
  if (failN) ElMessage.error(`${failN} 份上传失败`)
  loadList()
}

function onPickFiles(e) {
  handleFiles([...e.target.files])
  e.target.value = '' // 清 selection，否则重选同一文件不触发 change
}
function onPickDir(e) {
  handleFiles([...e.target.files]) // webkitdirectory 已是递归拍平的完整列表
  e.target.value = ''
}
async function onDrop(e) {
  dragOver.value = false
  const entries = [...(e.dataTransfer?.items || [])]
    .map((i) => i.webkitGetAsEntry?.())
    .filter(Boolean)
  if (!entries.length) return handleFiles([...(e.dataTransfer?.files || [])]) // 兜底：老浏览器没有 entry
  const groups = await Promise.all(entries.map(collectEntry))
  handleFiles(groups.flat())
}

// ---------- 台账列表 ----------
const loading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const keyword = ref('')
const statusTab = ref('')
let pollTimer = null
let connWarned = false // :8123 没起时只提醒一次，免得 3s 轮询刷屏

async function loadList() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize: pageSize.value }
    if (statusTab.value) params.status = statusTab.value
    if (keyword.value) params.keyword = keyword.value
    const res = await axios.get('/ingest/list', { params })
    list.value = res.data.records || []
    total.value = res.data.total || 0
    connWarned = false
    // 队列里有活 → 3 秒后自发一轮；全落账自动停，无常驻定时器
    clearTimeout(pollTimer)
    if (list.value.some((r) => r.status === 'queued')) pollTimer = setTimeout(loadList, 3000)
  } catch {
    list.value = []
    total.value = 0
    if (!connWarned) {
      connWarned = true
      ElMessage.error('摄取服务不在线（tsAgent :8123），请先 bun run service')
    }
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  loadList()
}
function onTab() {
  page.value = 1
  loadList()
}

// ---------- 行操作 ----------
const confirming = ref(null)

async function handleReingest(row) {
  try {
    await axios.post(`/ingest/${encodeURIComponent(row.doc_id)}/reingest`)
    ElMessage.success('已重新入队')
    loadList()
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '重摄请求失败')
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(
      `删除「${row.doc_id}」会同时清掉向量库切片、台账记录和盘上原文件，确定？`,
      '确认删除',
      { confirmButtonText: '确定删除', cancelButtonText: '取消', type: 'warning' },
    )
    confirming.value = row.doc_id
    const res = await axios.delete(`/ingest/${encodeURIComponent(row.doc_id)}`)
    const problems = res.data.problems || []
    if (problems.length) ElMessage.warning(`已删但有残留：${problems.join('；')}`)
    else ElMessage.success('已删除（向量库 + 台账 + 原文件）')
    loadList()
  } catch {
    /* 取消或失败（拦截不了裸 axios 的错，静默即可，列表没动就是没删） */
  } finally {
    confirming.value = null
  }
}

// ---------- 详情抽屉 ----------
const drawerVisible = ref(false)
const detail = ref({})

function openDetail(row) {
  detail.value = row
  drawerVisible.value = true
}

onMounted(() => loadList())
onUnmounted(() => clearTimeout(pollTimer))
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <h2>知识库</h2>
      <span class="sub">SDS / 规章 / SOP 等长文档入向量库，结构化数据走试剂管理不进这里</span>
    </div>

    <!-- 上传区：拖拽 + 两个按钮（选文件/选文件夹），爬虫不给 UI 入口 -->
    <div
      class="drop-zone"
      :class="{ 'drag-over': dragOver, busy: uploading }"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
      @click="!uploading && fileInput?.click()"
    >
      <template v-if="!uploading">
        <el-icon :size="42" color="#409eff"><UploadFilled /></el-icon>
        <p class="drop-title">把文件或文件夹拖到这里，或</p>
        <div class="drop-btns" @click.stop>
          <el-button type="primary" @click="fileInput?.click()">选择文件</el-button>
          <el-button @click="dirInput?.click()">选择文件夹</el-button>
        </div>
        <p class="drop-hint">{{ ACCEPT_HINT }}</p>
      </template>
      <template v-else>
        <p class="drop-title">上传中 {{ progress.done }} / {{ progress.total }}</p>
        <el-progress
          :percentage="Math.round((progress.done / Math.max(progress.total, 1)) * 100)"
          style="width: 60%; max-width: 400px"
        />
      </template>
    </div>
    <input ref="fileInput" type="file" multiple hidden :accept="ALLOW_EXT.map((e) => '.' + e).join(',')" @change="onPickFiles" />
    <input ref="dirInput" type="file" webkitdirectory multiple hidden @change="onPickDir" />

    <!-- 筛选行：状态 tabs + 关键字 -->
    <div class="search-bar" style="margin-top: 18px">
      <el-radio-group v-model="statusTab" @change="onTab">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button v-for="(v, k) in STATUS" :key="k" :value="k">{{ v.label }}</el-radio-button>
      </el-radio-group>
      <el-input v-model="keyword" placeholder="doc_id / 文件名" clearable style="width: 220px; margin-left: auto" @keyup.enter="search" @clear="search" />
      <el-button type="primary" @click="search">搜索</el-button>
      <el-button :loading="loading" @click="loadList">刷新</el-button>
    </div>

    <!-- 台账表 -->
    <el-card>
      <el-table :data="list" v-loading="loading" stripe border>
        <el-table-column prop="doc_id" label="文档" minWidth="180" show-overflow-tooltip />
        <el-table-column prop="file" label="原始文件" minWidth="160" show-overflow-tooltip />
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="STATUS[row.status]?.tag || 'info'" size="small">
              {{ STATUS[row.status]?.label || row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="chunks" label="切片" width="70" align="center" />
        <el-table-column label="耗时" width="90" align="center">
          <template #default="{ row }">{{ fmtCost(row.cost_ms) }}</template>
        </el-table-column>
        <el-table-column label="更新时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.updated_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openDetail(row)">详情</el-button>
            <el-button type="success" link :disabled="row.status === 'queued'" @click="handleReingest(row)">重摄</el-button>
            <el-button type="danger" link :loading="confirming === row.doc_id" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        style="margin-top: 16px; justify-content: flex-end"
        @change="loadList"
      />
    </el-card>

    <!-- 详情抽屉：flags 原文直读（[前门]/[拒收]/[隔离] 前缀本身就是人话） -->
    <el-drawer v-model="drawerVisible" :title="detail.doc_id" size="40%">
      <el-descriptions :column="1" border>
        <el-descriptions-item label="状态">
          <el-tag :type="STATUS[detail.status]?.tag || 'info'" size="small">{{ STATUS[detail.status]?.label || detail.status }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="切片数">{{ detail.chunks }}</el-descriptions-item>
        <el-descriptions-item label="解析耗时">{{ fmtCost(detail.cost_ms) }}</el-descriptions-item>
        <el-descriptions-item label="更新时间">{{ fmtTime(detail.updated_at) }}</el-descriptions-item>
        <el-descriptions-item label="原始文件">{{ detail.file }}</el-descriptions-item>
      </el-descriptions>
      <h4 style="margin: 16px 0 8px">解析标记（flags）</h4>
      <pre class="flags-box">{{ detail.flags || '（无）' }}</pre>
    </el-drawer>
  </div>
</template>

<style scoped>
.sub {
  color: #909399;
  font-size: 13px;
  margin-left: 12px;
}
.drop-zone {
  border: 1.5px dashed #c0c4cc;
  border-radius: 8px;
  padding: 32px;
  text-align: center;
  background: #fafbfc;
  cursor: pointer;
  transition: all 0.2s;
}
.drop-zone:hover,
.drop-zone.drag-over {
  border-color: #409eff;
  background: #ecf5ff;
}
.drop-zone.busy {
  cursor: default;
  border-style: solid;
}
.drop-title {
  margin: 10px 0 4px;
  font-size: 15px;
  color: #303133;
}
.drop-btns {
  margin: 12px 0;
}
.drop-hint {
  font-size: 12px;
  color: #909399;
}
.flags-box {
  white-space: pre-wrap;
  word-break: break-all;
  background: #f5f7fa;
  padding: 12px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.7;
}
</style>
