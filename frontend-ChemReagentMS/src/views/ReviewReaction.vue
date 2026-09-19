<script setup>
// 禁配/相容性审核（A 线）—— 把抽取出的候选审成正式规则，也在这里复核来源失效的规则
// 为什么需要它：store 层的 reviewCandidate/publishRule/reconfirmRuleSource 早就写好了，
//   但没有任何入口，候选只能躺在 reaction_candidate 表里 → reaction_rule 永远是空的 → 助手答不出禁配。
// 后端：tsAgent :8123 /reaction/*（DDL: deploy/sql/02_reaction_rule.sql；鉴权：reactionReview:query/audit）
//
// 安全提醒（写在页面上，不只在代码注释里）：发布的是"安全结论"，
//   每条规则都必须有原文证据与来源；证据不足就不发布 —— 不发布只是"查不到"，错发布是"误导实验操作"。
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import tsRequest from '@/utils/tsRequest'

const RELATION = {
  incompatible: '禁配（混合即危险）',
  storage_separate: '须分开储存',
  hazardous_reaction: '危险反应',
  conditionally_compatible: '条件共存',
}
const HAZARD = {
  heat: '放热', fire: '燃烧', explosion: '爆炸', toxic_gas: '有毒气体',
  flammable_gas: '易燃气体', pressure: '压力/爆沸', polymerization: '聚合', decomposition: '分解', other: '其他',
}
const REVIEW_STATUS = {
  pending: { label: '待审', tag: 'warning' },
  approved: { label: '已通过', tag: 'success' },
  rejected: { label: '已拒绝', tag: 'info' },
  superseded: { label: '已被取代', tag: 'info' },
}

// ---------- 候选列表 ----------
const loading = ref(false)
const rows = ref([])
const reviewStatus = ref('pending')
const sourceState = ref('')
const relationType = ref('')
const docId = ref('')

async function loadCandidates() {
  loading.value = true
  try {
    const data = await tsRequest.get('/reaction/candidates', {
      params: {
        reviewStatus: reviewStatus.value || undefined,
        sourceState: sourceState.value || undefined,
        relationType: relationType.value || undefined,
        docId: docId.value || undefined,
        limit: 100,
      },
    })
    rows.value = data.records || []
  } catch {
    rows.value = []
  } finally {
    loading.value = false
  }
}

/** 通过：只改候选状态（审核维度），**不会**自动发布规则 —— 发布是单独一步（要显式决定是否顶掉旧规则） */
async function approve(row) {
  try {
    await tsRequest.post(`/reaction/candidates/${row.id}/approve`, {})
    ElMessage.success(`候选 #${row.id} 已通过，可在下方"发布正式规则"里发布`)
    await loadCandidates()
  } catch { /* 已提示 */ }
}

async function reject(row) {
  const { value } = await ElMessageBox.prompt('拒绝理由（会记进审核记录）', '拒绝候选', {
    inputPlaceholder: '如：原文只是"避免接触"，不足以判定禁配',
    inputValue: '',
  }).catch(() => ({ value: null }))
  if (value === null) return
  try {
    await tsRequest.post(`/reaction/candidates/${row.id}/reject`, { note: value })
    ElMessage.success('已拒绝')
    await loadCandidates()
  } catch { /* 已提示 */ }
}

// ---------- 发布正式规则 ----------
const publishForm = ref({ candidateId: null, note: '', supersedeExisting: false })
async function publish() {
  if (!publishForm.value.candidateId) return ElMessage.warning('请填要发布的候选 id（可从上方列表拿）')
  try {
    const res = await tsRequest.post('/reaction/rules/publish', {
      candidateId: Number(publishForm.value.candidateId),
      note: publishForm.value.note || null,
      supersedeExisting: publishForm.value.supersedeExisting,
    })
    ElMessage.success(`已发布规则 #${res.rule?.id}（${RELATION[res.rule?.relationType] || res.rule?.relationType}）`)
    publishForm.value = { candidateId: null, note: '', supersedeExisting: false }
    await loadRules()
  } catch { /* 已提示：同 rule_key 已有 active 规则时会 409，要求显式 supersede */ }
}

// ---------- 已发布规则 ----------
const rules = ref([])
const ruleQuery = ref({ docId: '', aCas: '', bCas: '', aName: '', bName: '', cas: '', name: '' })
const includeSuperseded = ref(false)

async function loadRules() {
  const q = ruleQuery.value
  const params = {}
  if (includeSuperseded.value) params.includeSuperseded = 1
  if (q.docId) params.docId = q.docId
  else if (q.aCas || q.aName) { params.aCas = q.aCas; params.aName = q.aName; params.bCas = q.bCas; params.bName = q.bName }
  else if (q.cas || q.name) { params.cas = q.cas; params.name = q.name }
  else return ElMessage.warning('请给一种查法：doc_id / 单个物质(cas 或 name) / 两个物质(aCas|aName + bCas|bName)')
  try {
    const data = await tsRequest.get('/reaction/rules', { params })
    rules.value = data.records || []
    if (!rules.value.length) ElMessage.info('没有匹配的规则（"查不到"不等于"相容"）')
  } catch {
    rules.value = []
  }
}

/** 来源复核：source_stale/source_missing 的规则只有人工核对来源还在之后才能回 active */
async function reconfirm(rule) {
  await ElMessageBox.confirm(
    `我已核对该规则的来源文档仍然存在且内容未变，恢复为生效状态。\n规则 #${rule.id}：${rule.subjectName} × ${rule.objectName}`,
    '来源复核', { type: 'warning' },
  ).catch(() => Promise.reject(new Error('cancel')))
  try {
    await tsRequest.post(`/reaction/rules/${rule.id}/reconfirm`, {})
    ElMessage.success('已恢复 active')
    await loadRules()
  } catch { /* 已提示 */ }
}

onMounted(() => {
  loadCandidates()
})
</script>

<template>
  <div class="page">
    <el-alert type="warning" :closable="false" show-icon
      title="这里发布的是安全结论"
      description="每条规则都必须有原文证据与来源；证据不足就不发布——不发布只是查不到，错发布会误导实验操作。" />

    <el-card shadow="never" class="mt">
      <template #header><b>候选队列</b>（LLM 抽出来的候选；通过 ≠ 生效，发布才生效）</template>
      <div class="filters">
        <el-select v-model="reviewStatus" placeholder="审核状态" clearable style="width: 130px">
          <el-option label="待审" value="pending" />
          <el-option label="已通过" value="approved" />
          <el-option label="已拒绝" value="rejected" />
          <el-option label="已被取代" value="superseded" />
        </el-select>
        <el-select v-model="sourceState" placeholder="来源状态" clearable style="width: 130px">
          <el-option label="有效" value="active" />
          <el-option label="来源已变(待复核)" value="stale" />
        </el-select>
        <el-select v-model="relationType" placeholder="关系类型" clearable style="width: 160px">
          <el-option v-for="(label, key) in RELATION" :key="key" :label="label" :value="key" />
        </el-select>
        <el-input v-model="docId" placeholder="按来源 doc_id 过滤" clearable style="width: 220px" />
        <el-button type="primary" @click="loadCandidates">查询</el-button>
      </div>

      <el-table :data="rows" v-loading="loading" stripe>
        <el-table-column prop="id" label="#" width="70" align="center" />
        <el-table-column label="关系" width="150">
          <template #default="{ row }">
            <el-tag size="small" type="danger">{{ RELATION[row.relationType] || row.relationType }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="物质对" min-width="200">
          <template #default="{ row }">{{ row.subjectName }} × {{ row.objectName }}</template>
        </el-table-column>
        <el-table-column label="严重度/危害" width="180">
          <template #default="{ row }">
            {{ row.severity }}
            <span v-if="row.hazards?.length">｜{{ row.hazards.map((h) => HAZARD[h] || h).join('、') }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="evidenceText" label="证据原文" min-width="280" show-overflow-tooltip />
        <el-table-column label="来源" width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.source?.docId }}#{{ row.source?.chunkSeq }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="REVIEW_STATUS[row.reviewStatus]?.tag">{{ REVIEW_STATUS[row.reviewStatus]?.label || row.reviewStatus }}</el-tag>
            <el-tag v-if="row.sourceState === 'stale'" size="small" type="warning" class="ml4">来源已变</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <template v-if="row.reviewStatus === 'pending'">
              <el-button link type="primary" @click="approve(row)">通过</el-button>
              <el-button link type="danger" @click="reject(row)">拒绝</el-button>
            </template>
            <el-button v-else link type="primary" @click="publishForm.candidateId = row.id">拿去发布</el-button>
          </template>
        </el-table-column>
        <template #empty>没有匹配的候选（抽取脚本还没跑，或 02 的 SQL 没执行）</template>
      </el-table>
    </el-card>

    <el-card shadow="never" class="mt">
      <template #header><b>发布正式规则</b>（只有 approved 的候选能发布；同 rule_key 已有生效规则时必须显式勾选取代）</template>
      <div class="publish">
        <el-input v-model="publishForm.candidateId" placeholder="候选 id" style="width: 140px" />
        <el-input v-model="publishForm.note" placeholder="发布备注（可选）" style="width: 260px" />
        <el-checkbox v-model="publishForm.supersedeExisting">取代同 rule_key 的现行规则</el-checkbox>
        <el-button type="primary" @click="publish">发布</el-button>
      </div>
    </el-card>

    <el-card shadow="never" class="mt">
      <template #header><b>已发布规则</b>（助手只认这里的 active 规则；来源失效的规则需人工复核才能恢复）</template>
      <div class="filters">
        <el-input v-model="ruleQuery.docId" placeholder="按来源 doc_id" style="width: 200px" />
        <el-input v-model="ruleQuery.aCas" placeholder="物质A CAS" style="width: 140px" />
        <el-input v-model="ruleQuery.aName" placeholder="或 物质A 名称" style="width: 140px" />
        <el-input v-model="ruleQuery.bCas" placeholder="物质B CAS" style="width: 140px" />
        <el-input v-model="ruleQuery.bName" placeholder="或 物质B 名称" style="width: 140px" />
        <el-checkbox v-model="includeSuperseded">含已被取代</el-checkbox>
        <el-button type="primary" @click="loadRules">查询规则</el-button>
      </div>
      <el-table :data="rules" stripe>
        <el-table-column prop="id" label="#" width="70" align="center" />
        <el-table-column label="关系" width="150">
          <template #default="{ row }">{{ RELATION[row.relationType] || row.relationType }}</template>
        </el-table-column>
        <el-table-column label="物质对" min-width="180">
          <template #default="{ row }">{{ row.subjectName }} × {{ row.objectName }}</template>
        </el-table-column>
        <el-table-column prop="evidenceText" label="证据原文" min-width="240" show-overflow-tooltip />
        <el-table-column label="状态" width="170">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'active' ? 'success' : 'info'">{{ row.status }}</el-tag>
            <el-tag v-if="row.sourceState !== 'active'" size="small" type="warning" class="ml4">{{ row.sourceState }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.sourceState !== 'active'" link type="warning" @click="reconfirm(row)">来源复核</el-button>
          </template>
        </el-table-column>
        <template #empty>还没有已发布规则 —— 助手查禁配时会回"证据不足"（这是对的，不是 bug）</template>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.mt { margin-top: 16px; }
.filters { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
.publish { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.ml4 { margin-left: 4px; }
</style>
