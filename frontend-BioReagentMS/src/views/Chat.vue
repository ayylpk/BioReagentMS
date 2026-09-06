<script setup>
import { ref, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { marked } from 'marked'

// publicMode=true：/assistant 免登录演示通道（路由 props 注入）
//   后端按 mode 关台账路+限流；前端换一套 pub_* 临时档，与管理版会话互不串台
const props = defineProps({
  publicMode: { type: Boolean, default: false },
})
const NS = props.publicMode ? 'pub_' : ''

// ── 临时会话（9/6 拍板）：聊天内容只在本次登录内保留 ──
// 历史+线程键放 sessionStorage（关标签页/退出即失效），登出时 auth.logout() 负责清 chat_*
// 服务端 MemorySaver 同为内存档：进程重启 = 上下文归零，两端生命周期天然一致
const HIST_KEY = NS + 'chat_hist'
const THREAD_KEY = NS + 'chat_thread'
const newThread = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(16).slice(2)}`)

const messages = ref([])
try {
  const raw = sessionStorage.getItem(HIST_KEY)
  if (raw) messages.value = JSON.parse(raw) // 刷新页面历史还在（会话未退出）
} catch { /* 坏档直接当空会话 */ }
if (!sessionStorage.getItem(THREAD_KEY)) sessionStorage.setItem(THREAD_KEY, newThread())
const threadId = ref(sessionStorage.getItem(THREAD_KEY))

// 只存纯文本轮（图片等富对象不进临时档），失败不炸聊天
function persist() {
  try {
    sessionStorage.setItem(HIST_KEY, JSON.stringify(messages.value.map((m) => ({ role: m.role, content: m.content }))))
  } catch { /* 存储满之类，忽略 */ }
}

const inputText = ref('')
const loading = ref(false)
const chatBox = ref(null)

function md(text) {
  if (!text) return ''
  return marked(text, { breaks: true })
}

async function scrollBottom() {
  await nextTick()
  if (chatBox.value) {
    chatBox.value.scrollTop = chatBox.value.scrollHeight
  }
}

async function send() {
  const text = inputText.value.trim()
  if (!text || loading.value) return

  messages.value.push({ role: 'user', content: text })
  inputText.value = ''
  await scrollBottom()

  const aiMsg = { role: 'assistant', content: '' }
  messages.value.push(aiMsg)
  loading.value = true
  persist()

  try {
    // 协议：Hono /agent/runs/stream 自写最小子集（见 tsAgent src/service/routes/stream.ts）
    // 只发本轮 question —— 多轮上下文靠服务端 thread_id 记忆，不再整段历史重放（旧 py 时代的姿势）
    const response = await fetch('/agent/runs/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assistant_id: 'reagent_assistant',
        mode: props.publicMode ? 'public' : 'authed',
        input: { question: text },
        config: { configurable: { thread_id: threadId.value } },
      }),
    })
    if (!response.ok) {
      throw new Error(`Agent 服务错误: ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      // SSE 事件按空行切；残包留 buffer 下轮拼
      const events = buffer.split('\n\n')
      buffer = events.pop()

      for (const raw of events) {
        const m = raw.match(/^data:\s?(.+)$/m)
        if (!m) continue
        try {
          onEvent(JSON.parse(m[1]), aiMsg)
          await scrollBottom() // 逐 token 跟手
        } catch { /* 半截 JSON 等下一包 */ }
      }
    }
  } catch (e) {
    aiMsg.content = aiMsg.content || `请求失败: ${e.message}`
    ElMessage.error('智能体请求失败')
  } finally {
    loading.value = false
    persist()
    await scrollBottom()
  }
}

// 事件分发：ai_chunk 增量上屏 / error 追加人话 / done 收工
function onEvent(evt, aiMsg) {
  if (!evt || typeof evt !== 'object') return
  if (evt.type === 'ai_chunk') aiMsg.content += evt.text ?? ''
  else if (evt.type === 'error') aiMsg.content += `\n⚠️ ${evt.message || '服务端异常'}`
}

// 新会话：换线程键 + 清临时档（服务端旧线程自然弃坑，窗口记忆随 MEMORY_WINDOW 走）
function newChat() {
  messages.value = []
  threadId.value = newThread()
  sessionStorage.setItem(THREAD_KEY, threadId.value)
  sessionStorage.removeItem(HIST_KEY)
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}
</script>

<template>
  <div class="chat-container" :class="{ public: publicMode }">
    <div v-if="publicMode" class="public-banner">
      <span class="pb-title">BioReagentMS · 实验室助手免登录体验</span>
      <span class="pb-note">可问化学品 SDS / 安全处置等文档问题；库存台账等内部数据需登录后查看</span>
    </div>
    <div class="chat-toolbar">
      <span class="toolbar-hint">{{ publicMode ? '体验记录仅本浏览器会话内保留' : '对话记录仅本次登录内保留，退出即清空' }}</span>
      <el-button size="small" :disabled="loading || !messages.length" @click="newChat">新会话</el-button>
    </div>
    <div ref="chatBox" class="chat-box">
      <div v-if="messages.length === 0" class="chat-empty">
        <el-icon :size="48" color="#c0c4cc"><ChatDotRound /></el-icon>
        <p v-if="publicMode">你好，我是化学品安全演示助手。试试问"丙酮着火了怎么办"或"氯化钠的储存要求"。</p>
        <p v-else>你好，我是实验室助手。可以问我试剂信息、库存情况、预警记录等问题。</p>
      </div>

      <div
        v-for="(msg, i) in messages"
        :key="i"
        class="message-row"
        :class="msg.role === 'user' ? 'row-user' : 'row-ai'"
      >
        <div class="avatar">
          <img v-if="msg.role === 'user'" src="/avatar-default.png" alt="user" />
          <img v-else src="/logo.png" alt="ai" />
        </div>
        <div class="bubble" :class="msg.role === 'user' ? 'bubble-user' : 'bubble-ai'">
          <div v-if="msg.role === 'user'" class="bubble-text">{{ msg.content }}</div>
          <div v-else class="bubble-text markdown-body" v-html="md(msg.content)"></div>
          <span v-if="loading && i === messages.length - 1 && !msg.content" class="typing">
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          </span>
        </div>
      </div>
    </div>

    <div class="input-area">
      <el-input
        v-model="inputText"
        type="textarea"
        :rows="2"
        placeholder="输入消息，Enter 发送 / Shift+Enter 换行"
        :disabled="loading"
        @keydown="onKeydown"
        resize="none"
      />
      <el-button type="primary" :disabled="loading || !inputText.trim()" @click="send">
        发送
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.chat-container {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 56px - 40px - 56px);
  max-width: 900px;
  margin: 0 auto;
}
/* 免登录体验页：不在 MainLayout 里，占满全屏自己当布局 */
.chat-container.public {
  height: 100vh;
  max-width: 860px;
  padding: 0 20px;
}
.public-banner {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  align-items: baseline;
  padding: 14px 0 4px;
}
.pb-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}
.pb-note {
  font-size: 12px;
  color: #909399;
}
.chat-toolbar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}
.toolbar-hint {
  font-size: 12px;
  color: #909399;
}

.chat-box {
  flex: 1;
  overflow-y: auto;
  padding: 20px 0;
}

.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #909399;
  gap: 12px;
}
.chat-empty p {
  font-size: 14px;
}

.message-row {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  align-items: flex-start;
}

.row-user {
  flex-direction: row-reverse;
}

.avatar img {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
}

.bubble {
  max-width: 70%;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.7;
  word-break: break-word;
}

.bubble-user {
  background: #409eff;
  color: #fff;
  border-bottom-right-radius: 4px;
}

.bubble-ai {
  background: #fff;
  color: #303133;
  border-bottom-left-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}

.bubble-text {
  white-space: pre-wrap;
}

/* ── Markdown 渲染样式 ── */
.markdown-body :deep(h1) { font-size: 1.2em; margin: 0.5em 0 0.3em; }
.markdown-body :deep(h2) { font-size: 1.1em; margin: 0.5em 0 0.3em; }
.markdown-body :deep(h3) { font-size: 1em; margin: 0.4em 0 0.2em; }
.markdown-body :deep(p) { margin: 0.3em 0; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { padding-left: 1.2em; margin: 0.3em 0; }
.markdown-body :deep(li) { margin: 0.1em 0; }
.markdown-body :deep(table) { border-collapse: collapse; margin: 0.5em 0; font-size: 0.9em; width: 100%; }
.markdown-body :deep(th), .markdown-body :deep(td) { border: 1px solid #dcdfe6; padding: 4px 8px; text-align: left; }
.markdown-body :deep(th) { background: #f0f2f5; font-weight: 600; }
.markdown-body :deep(blockquote) { border-left: 3px solid #409eff; margin: 0.4em 0; padding: 0.2em 0.6em; color: #606266; background: #ecf5ff; border-radius: 0 4px 4px 0; }
.markdown-body :deep(code) { background: #f0f2f5; padding: 1px 5px; border-radius: 3px; font-size: 0.9em; }
.markdown-body :deep(pre) { background: #f0f2f5; padding: 8px 12px; border-radius: 6px; overflow-x: auto; margin: 0.4em 0; }
.markdown-body :deep(pre code) { background: none; padding: 0; }
.markdown-body :deep(hr) { border: none; border-top: 1px solid #ebeef5; margin: 0.6em 0; }
.markdown-body :deep(strong) { font-weight: 600; }
.markdown-body :deep(em) { font-style: italic; }

.typing {
  display: inline-flex;
  gap: 4px;
  padding: 4px 0;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #909399;
  animation: blink 1.4s infinite ease-in-out both;
}

.dot:nth-child(1) { animation-delay: 0s; }
.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes blink {
  0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

.input-area {
  display: flex;
  gap: 12px;
  padding: 16px 0;
  background: #f5f7fa;
  align-items: flex-end;
}

.input-area :deep(.el-textarea__inner) {
  font-size: 14px;
  line-height: 1.6;
}

.input-area .el-button {
  height: 42px;
}
</style>
