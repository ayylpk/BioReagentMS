<script setup>
// 解析层人审（B 线）—— 台账上"待人审/隔离"的文档在这里处置
// 为什么需要它：过闸门不过/前门判死的文档既往只能"删了重传"；现在能看到档案+解析原文，
//   改完直接确认入库（走重新切块 + 真入库），或驳回。人工改过的 blocks 会在后端存档成回归样本。
// 后端：tsAgent :8123 /review/*（DDL: deploy/sql/04_rag_review_queue.sql；鉴权：ragReview:query/audit）
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import tsRequest from '@/utils/tsRequest'

const STATUS = {
  pending: { label: '待人审', tag: 'warning' },
  confirmed: { label: '已确认入库', tag: 'success' },
  rejected: { label: '已驳回', tag: 'danger' },
}
const ORIGIN = {
  'front-door': '前门判死（L2）',
  'parser-reject': '解析器拒收',
  gate: '闸门不过',
  'needs-upgrade': '能力未接（隔离）',
}

const loading = ref(false)
const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const status = ref('pending')
const keyword = ref('')

async function load() {
  loading.value = true
  try {
    const data = await tsRequest.get('/review/pending', {
      params: { status: status.value, keyword: keyword.value, page: page.value, pageSize: pageSize.value },
    })
    rows.value = data.records || []
    total.value = data.total || 0
  } catch {
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

// ---------- 详情 / 编辑 ----------
const detail = ref(null)
const detailVisible = ref(false)
const blocksText = ref('')
const note = ref('')

async function open(docId) {
  try {
    const d = await tsRequest.get(`/review/${encodeURIComponent(docId)}`)
    detail.value = d
    blocksText.value = JSON.stringify(d.editedBlocks || d.blocks || [], null, 2)
    note.value = ''
    detailVisible.value = true
  } catch { /* 拦截器已提示 */ }
}

const blocksValid = computed(() => {
  if (!blocksText.value.trim()) return true // 空 = 用原解析结果确认
  try {
    const v = JSON.parse(blocksText.value)
    return Array.isArray(v)
  } catch {
    return false
  }
})

async function confirmIn() {
  if (!blocksValid.value) return ElMessage.warning('blocks 不是合法 JSON 数组')
  const edited = blocksText.value.trim() ? JSON.parse(blocksText.value) : undefined
  await ElMessageBox.confirm(
    edited
      ? `将用你修改后的 ${edited.length} 个块重新切块并**直接写入知识库**（不再过闸门判死）。确认？`
      : '将用解析原文重新切块并写入知识库。确认？',
    '确认入库', { type: 'warning' },
  )
  try {
    const res = await tsRequest.post(`/review/${encodeURIComponent(detail.value.docId)}/confirm`, {
      ...(edited ? { blocks: edited } : {}),
      ...(note.value ? { note: note.value } : {}),
    })
    ElMessage.success(`已入库：${res.chunks} 个切片`)
    detailVisible.value = false
    await load()
  } catch { /* 拦截器已提示 */ }
}

async function reject() {
  const { value } = await ElMessageBox.prompt('驳回理由（会记进台账，便于以后排查）', '驳回', {
    inputPlaceholder: '如：扫描件质量太差，已让用户重新扫描',
    inputValue: '',
  }).catch(() => ({ value: null }))
  if (value === null) return
  try {
    await tsRequest.post(`/review/${encodeURIComponent(detail.value.docId)}/reject`, { note: value })
    ElMessage.success('已驳回')
    detailVisible.value = false
    await load()
  } catch { /* 拦截器已提示 */ }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <el-card shadow="never">
      <template #header>
        <div class="head">
          <span>解析层人审</span>
          <span class="sub">台账里"待人审/隔离"的文档在这里处置：改完确认入库，或驳回</span>
        </div>
      </template>

      <div class="filters">
        <el-radio-group v-model="status" @change="() => { page = 1; load() }">
          <el-radio-button value="pending">待人审</el-radio-button>
          <el-radio-button value="confirmed">已确认</el-radio-button>
          <el-radio-button value="rejected">已驳回</el-radio-button>
          <el-radio-button value="">全部</el-radio-button>
        </el-radio-group>
        <el-input v-model="keyword" placeholder="按 doc_id / 文件名 / 理由搜" clearable style="width: 260px"
          @keyup.enter="() => { page = 1; load() }" />
        <el-button type="primary" @click="() => { page = 1; load() }">查询</el-button>
      </div>

      <el-table :data="rows" v-loading="loading" stripe>
        <el-table-column prop="docId" label="文档" min-width="200" show-overflow-tooltip />
        <el-table-column label="来源" width="140">
          <template #default="{ row }">
            <el-tag size="small" type="info">{{ ORIGIN[row.origin] || row.origin }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="为什么进来" min-width="260" show-overflow-tooltip />
        <el-table-column prop="blocksCount" label="解析块" width="80" align="center" />
        <el-table-column label="状态" width="110" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="STATUS[row.status]?.tag">{{ STATUS[row.status]?.label || row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="open(row.docId)">查看/处置</el-button>
          </template>
        </el-table-column>
        <template #empty>没有待审文档（解析层干净，或 04 的 SQL 还没跑）</template>
      </el-table>

      <el-pagination class="pager" layout="total, prev, pager, next" :total="total"
        :current-page="page" :page-size="pageSize"
        @current-change="(p) => { page = p; load() }" />
    </el-card>

    <el-dialog v-model="detailVisible" :title="detail?.docId" width="900px" top="6vh">
      <div v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="文件">{{ detail.file }}</el-descriptions-item>
          <el-descriptions-item label="家族 / 策略">
            {{ detail.profile?.family || '—' }} / {{ detail.profile?.strategy || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="理由" :span="2">{{ detail.reason || '—' }}</el-descriptions-item>
        </el-descriptions>
        <div class="hint">
          解析结果（可编辑：这就是要入库的内容。改过的版本会存档为回归样本；留空则用原文）
        </div>
        <el-input v-model="blocksText" type="textarea" :rows="14" spellcheck="false"
          :class="{ bad: !blocksValid }" />
        <div v-if="!blocksValid" class="err">不是合法 JSON 数组 —— 请先修好再确认</div>
        <el-collapse class="collapse">
          <el-collapse-item title="台账 flags（抽取账本 + 闸门灯语）">
            <pre class="flags">{{ (detail.flags || []).join('\n') }}</pre>
          </el-collapse-item>
        </el-collapse>
        <el-input v-model="note" placeholder="备注（可选，会记进台账）" />
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button type="danger" @click="reject">驳回</el-button>
        <el-button type="primary" :disabled="!blocksValid" @click="confirmIn">确认入库</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.head { display: flex; align-items: baseline; gap: 12px; }
.sub { color: #909399; font-size: 12px; }
.filters { display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
.pager { margin-top: 12px; justify-content: flex-end; }
.hint { margin: 12px 0 6px; color: #606266; font-size: 13px; }
.err { color: #f56c6c; font-size: 12px; margin-top: 4px; }
.collapse { margin-top: 12px; }
.flags { margin: 0; font-size: 12px; color: #606266; white-space: pre-wrap; max-height: 220px; overflow: auto; }
.bad :deep(textarea) { border-color: #f56c6c; }
</style>
