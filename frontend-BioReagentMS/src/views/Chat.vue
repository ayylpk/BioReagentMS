<script setup>
import { ref, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { marked } from 'marked'

const messages = ref([])

function md(text) {
  if (!text) return ''
  return marked(text, { breaks: true })
}
const inputText = ref('')
const loading = ref(false)
const chatBox = ref(null)

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

  try {
    const response = await fetch('/agent/runs/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assistant_id: 'reagent_assistant',
        input: {
          messages: messages.value
            .filter(m => m.content)
            .map(m => ({ role: m.role, content: m.content })),
        },
        stream_mode: 'messages',
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

      // 兼容 SSE 和 ndjson 两种格式
      let events = buffer.split('\n\n')
      buffer = events.pop()

      // 无双换行 → 回退单行 ndjson
      if (events.length === 0) {
        const lines = buffer.split('\n')
        buffer = lines.pop()
        events = lines
      }

      for (const raw of events) {
        if (!raw.trim()) continue

        // 提取 JSON: 匹配 data: 前缀，否则整行当 JSON
        let jsonStr = raw
        const m = raw.match(/^data:\s?(.+)$/m)
        if (m) jsonStr = m[1]

        try {
          const c = extractContent(JSON.parse(jsonStr))
          if (c) {
            aiMsg.content = c             
            await nextTick()
            scrollBottom()
          }
        } catch { /* skip */ }
      }
    }
  } catch (e) {
    aiMsg.content = `请求失败: ${e.message}`
    ElMessage.error('智能体请求失败')
  } finally {
    loading.value = false
    await scrollBottom()
  }
}

// 从 LangGraph 消息数组中取最后一条 AI 消息（chunk 是累积的完整消息列表）
function extractContent(chunk) {
  if (!chunk || typeof chunk !== 'object') return ''

  if (Array.isArray(chunk)) {
    for (let i = chunk.length - 1; i >= 0; i--) {
      const item = chunk[i]
      if (item.type === 'ai' || item.type === 'AIMessageChunk') {
        if (typeof item.content === 'string') return item.content
        if (Array.isArray(item.content)) {
          return item.content.map(c => c.text || '').join('')
        }
      }
    }
    return ''
  }
  if (chunk.content && (chunk.type === 'ai' || chunk.type === 'AIMessageChunk')) {
    return typeof chunk.content === 'string' ? chunk.content : ''
  }
  return ''
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}
</script>

<template>
  <div class="chat-container">
    <div ref="chatBox" class="chat-box">
      <div v-if="messages.length === 0" class="chat-empty">
        <el-icon :size="48" color="#c0c4cc"><ChatDotRound /></el-icon>
        <p>你好，我是实验室助手。可以问我试剂信息、库存情况、预警记录等问题。</p>
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
