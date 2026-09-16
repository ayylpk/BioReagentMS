<script setup>
// 缺口知识 —— 本地知识库没查到的问题，由 AI 生成一段带免责的通用参考，落到 MySQL 等人工处置
//
// 为什么是这样一条链（而不是让 AI 直接写进知识库）：
//   这个系统靠"溯源到 SDS 原文"吃饭，把模型生成的内容直接塞进向量库 = 把生成物伪装成文献证据。
//   所以：检索空手 → 生成（强制免责声明 + 不许给安全数值/混放结论）→ 进 MySQL pending →
//   在这里人工看、必要时改写 → 点「完成」。完成之后**同一个问题再被问到会直接复用这条内容**，
//   不再重复生成；点「忽略」则下次重新生成一条。
//
// 后端：tsAgent :8123 /gap/*（DDL: deploy/sql/05_rag_gap_knowledge.sql；鉴权：gapKnowledge:query/audit）
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import tsRequest from '@/utils/tsRequest'

const STATUS = {
  pending: { label: '待确认', tag: 'warning' },
  done: { label: '已完成', tag: 'success' },
  ignored: { label: '已忽略', tag: 'info' },
}

const loading = ref(false)
const rows = ref([])
const total = ref(0)
const pending = ref(null)
const page = ref(1)
const pageSize = ref(10)
const status = ref('pending')
const keyword = ref('')

async function load() {
  loading.value = true
  try {
    const data = await tsRequest.get('/gap/list', {
      params: { status: status.value, keyword: keyword.value, page: page.value, pageSize: pageSize.value },
    })
    rows.value = data.records || []
    total.value = data.total || 0
    pending.value = data.pending
  } catch {
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

// ---------- 详情 / 处置 ----------
const detail = ref(null)
const visible = ref(false)
const answerDraft = ref('')

const dirty = computed(() => detail.value && answerDraft.value !== detail.value.answer)

async function open(id) {
  try {
    const d = await tsRequest.get(`/gap/${id}`)
    detail.value = d
    answerDraft.value = d.answer || ''
    visible.value = true
  } catch { /* 拦截器已提示 */ }
}

async function finish(remove = false) {
  if (remove) {
    const { value } = await ElMessageBox.prompt('忽略理由（会留痕，便于以后判断这类问题值不值得答）', '忽略', {
      inputPlaceholder: '如：与实验室业务无关',
      inputValue: '',
    }).catch(() => ({ value: null }))
    if (value === null) return
    try {
      await tsRequest.post(`/gap/${detail.value.id}/ignore`, {})
      ElMessage.success('已忽略：下次同样的问题会重新生成一条')
      visible.value = false
      await load()
    } catch { /* 已提示 */ }
    return
  }
  await ElMessageBox.confirm(
    dirty.value
      ? '你修改过内容：将以修改后的版本保存为「已完成」。之后同样的问题会直接复用这条。确认？'
      : '确认这条内容可用？之后同样的问题会直接复用这条（不再重新生成）。',
    '完成', { type: 'warning' },
  ).catch(() => Promise.reject(new Error('cancel')))
  try {
    await tsRequest.post(`/gap/${detail.value.id}/done`, { answer: answerDraft.value })
    ElMessage.success('已完成：同问题将复用这条内容')
    visible.value = false
    await load()
  } catch { /* 已提示 */ }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <el-card shadow="never">
      <template #header>
        <div class="head">
          <span>缺口知识</span>
          <span class="sub">本地库没查到的问题 → AI 生成通用参考 → 人工确认（内容存在 MySQL，不进向量库）</span>
          <el-tag v-if="pending !== null" type="warning" class="badge">待确认 {{ pending }}</el-tag>
        </div>
      </template>

      <div class="filters">
        <el-radio-group v-model="status" @change="() => { page = 1; load() }">
          <el-radio-button value="pending">待确认</el-radio-button>
          <el-radio-button value="done">已完成</el-radio-button>
          <el-radio-button value="ignored">已忽略</el-radio-button>
          <el-radio-button value="">全部</el-radio-button>
        </el-radio-group>
        <el-input v-model="keyword" placeholder="按问题 / 内容搜" clearable style="width: 260px"
          @keyup.enter="() => { page = 1; load() }" />
        <el-button type="primary" @click="() => { page = 1; load() }">查询</el-button>
      </div>

      <el-table :data="rows" v-loading="loading" stripe>
        <el-table-column prop="id" label="#" width="70" align="center" />
        <el-table-column prop="question" label="问题" min-width="240" show-overflow-tooltip />
        <el-table-column prop="answer" label="AI 生成的参考" min-width="320" show-overflow-tooltip />
        <el-table-column label="问了几次" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.askCount > 1 ? 'warning' : 'info'">{{ row.askCount }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="STATUS[row.status]?.tag">{{ STATUS[row.status]?.label || row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ new Date(row.updatedAt).toLocaleString('zh-CN', { hour12: false }) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="open(row.id)">查看/处置</el-button>
          </template>
        </el-table-column>
        <template #empty>没有记录 —— 说明本地知识库都答得上，或者 05 的 SQL 还没执行</template>
      </el-table>

      <el-pagination class="pager" layout="total, sizes, prev, pager, next" :total="total"
        :current-page="page" :page-size="pageSize" :page-sizes="[10, 20, 50]"
        @current-change="(p) => { page = p; load() }"
        @size-change="(s) => { pageSize = s; page = 1; load() }" />
    </el-card>

    <el-dialog v-model="visible" title="缺口详情" width="860px" top="6vh">
      <div v-if="detail">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="问题">{{ detail.question }}</el-descriptions-item>
          <el-descriptions-item label="元信息">
            #{{ detail.id }}｜状态 {{ STATUS[detail.status]?.label }}｜被问 {{ detail.askCount }} 次｜
            模型 {{ detail.model || '—' }}｜route {{ detail.route || '—' }}
          </el-descriptions-item>
        </el-descriptions>

        <div class="hint">
          内容（可直接编辑：改写后点完成，以你写的为准 —— 人写过的东西才是这条记录最值钱的部分）
        </div>
        <el-input v-model="answerDraft" type="textarea" :rows="12" />
        <div v-if="dirty" class="dirty">已修改（未保存）</div>

        <el-collapse v-if="detail.nearMisses?.length" class="collapse">
          <el-collapse-item title="检索时的弱命中线索（人工补资料时看差在哪）">
            <pre class="flags">{{ (detail.nearMisses || []).join('\n---\n') }}</pre>
          </el-collapse-item>
        </el-collapse>
      </div>
      <template #footer>
        <el-button @click="visible = false">关闭</el-button>
        <el-button v-if="detail?.status !== 'ignored'" @click="finish(true)">忽略</el-button>
        <el-button type="primary" @click="finish(false)">完成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.head { display: flex; align-items: baseline; gap: 12px; }
.sub { color: #909399; font-size: 12px; }
.badge { margin-left: auto; }
.filters { display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
.pager { margin-top: 12px; justify-content: flex-end; }
.hint { margin: 12px 0 6px; color: #606266; font-size: 13px; }
.dirty { color: #e6a23c; font-size: 12px; margin-top: 4px; }
.collapse { margin-top: 12px; }
.flags { margin: 0; font-size: 12px; color: #606266; white-space: pre-wrap; max-height: 200px; overflow: auto; }
</style>
