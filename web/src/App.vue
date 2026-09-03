<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { chatStream } from './api'
import type { ChatMessage, SourceItem } from './api'

interface DisplayMessage {
  role: 'user' | 'assistant'
  content: string
  sources: SourceItem[]
  total: number
  error?: boolean
  interrupted?: boolean
  retryHistory?: ChatMessage[]
}

const messages = ref<DisplayMessage[]>([])
const input = ref('')
const streaming = ref(false)
const listEl = ref<HTMLElement | null>(null)
let abortCtrl: AbortController | null = null

// ---- 原文查看弹窗 ----
const sourceModal = ref(false)
const sourceTitle = ref('')
const sourceHtml = ref('')

const suggestions = [
  '中央空调高压报警怎么处理？',
  '电梯困人了怎么处置？',
  '消防主机误报怎么办？',
  '监控录像要保存多久？',
  '配电房停电了怎么办？',
]

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function scrollToBottom() {
  void nextTick(() => {
    const el = listEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

async function openSource(file: string, chunkText: string) {
  try {
    const resp = await fetch(`/api/source?file=${encodeURIComponent(file)}`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const raw = await resp.text()
    const escaped = escapeHtml(raw)
    // 高亮：在原文中定位片段文本（按首个出现位置）
    const target = escapeHtml(chunkText.trim())
    let html = escaped
    const idx = escaped.indexOf(target)
    if (idx >= 0) {
      html = escaped.slice(0, idx) + '<mark class="hl">' + target + '</mark>' + escaped.slice(idx + target.length)
    }
    sourceTitle.value = file
    sourceHtml.value = html
    sourceModal.value = true
    void nextTick(() => {
      document.querySelector('.source-body mark.hl')?.scrollIntoView({ block: 'center' })
    })
  } catch (e) {
    alert('原文加载失败：' + ((e as Error).message || '未知错误'))
  }
}

function closeSource() {
  sourceModal.value = false
}

async function runChat(history: ChatMessage[], botMsg: DisplayMessage) {
  botMsg.error = false
  botMsg.interrupted = false
  botMsg.content = ''
  streaming.value = true
  let doneReceived = false

  abortCtrl = new AbortController()
  const signal = abortCtrl.signal

  try {
    await chatStream(
      history,
      {
        onDelta: (t) => {
          botMsg.content += t
          scrollToBottom()
        },
        onSources: (sources, total) => {
          botMsg.sources = sources
          botMsg.total = total
        },
        onError: (msg) => {
          botMsg.content = `⚠️ ${msg}`
          botMsg.error = true
          doneReceived = true
        },
        onDone: () => {
          doneReceived = true
          if (!botMsg.content) botMsg.content = '（没有生成回答内容）'
        },
      },
      5,
      signal,
    )
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      botMsg.content = `⚠️ ${(e as Error).message || '请求失败'}`
      botMsg.error = true
    }
  } finally {
    streaming.value = false
    abortCtrl = null
    // 流意外结束且未收到 done → 判定连接中断，提供重试
    if (!doneReceived && !botMsg.error) {
      botMsg.interrupted = true
      botMsg.retryHistory = history
    }
    scrollToBottom()
  }
}

async function send(text?: string) {
  const content = (text ?? input.value).trim()
  if (!content || streaming.value) return

  messages.value.push({ role: 'user', content, sources: [], total: 0 })
  const botMsg: DisplayMessage = { role: 'assistant', content: '', sources: [], total: 0 }
  messages.value.push(botMsg)
  input.value = ''
  scrollToBottom()

  const history: ChatMessage[] = messages.value.map((m) => ({ role: m.role, content: m.content }))
  await runChat(history, botMsg)
}

function retry(botMsg: DisplayMessage) {
  if (!botMsg.retryHistory || streaming.value) return
  void runChat(botMsg.retryHistory, botMsg)
}

function stop() {
  abortCtrl?.abort()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void send()
  }
}
</script>

<template>
  <div class="chat-app">
    <header class="chat-header">
      <h1>园区设备知识库问答</h1>
      <div class="sub">RAG Demo · Vue3 + Node.js + SSE 流式 · 回答附引用来源</div>
    </header>

    <main ref="listEl" class="messages">
      <div v-if="messages.length === 0" class="empty-tip">
        <p>输入问题，或点下面的示例问题试试：</p>
        <div class="suggestion-chips">
          <button v-for="s in suggestions" :key="s" class="chip" @click="send(s)">{{ s }}</button>
        </div>
      </div>

      <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
        <div class="bubble" :class="{ 'error-bubble': m.error }">
          {{ m.content }}
          <span v-if="streaming && i === messages.length - 1 && !m.content" class="typing">
            <span></span><span></span><span></span>
          </span>
        </div>

        <button v-if="m.interrupted" class="retry-btn" @click="retry(m)">⚠️ 连接中断 · 点击重试</button>

        <details v-if="m.role === 'assistant' && m.sources.length" class="sources">
          <summary>参考来源（{{ m.sources.length }} 条 / 知识库共 {{ m.total }} 条）</summary>
          <div class="list">
            <div v-for="(s, j) in m.sources" :key="j" class="source-card">
              <div class="src">
                📄 {{ s.source }}
                <span class="score">相似度 {{ s.score }}</span>
                <button class="view-src" @click="openSource(s.source, s.text)">查看原文</button>
              </div>
              <div>{{ s.text }}</div>
            </div>
          </div>
        </details>
      </div>
    </main>

    <footer class="composer">
      <textarea
        v-model="input"
        rows="1"
        :placeholder="streaming ? '正在回答…' : '输入设备运维问题，Enter 发送，Shift+Enter 换行'"
        @keydown="onKeydown"
      ></textarea>
      <button v-if="streaming" @click="stop">停止</button>
      <button v-else :disabled="!input.trim()" @click="send()">发送</button>
    </footer>

    <!-- 原文查看弹窗 -->
    <div v-if="sourceModal" class="modal-mask" @click.self="closeSource">
      <div class="modal">
        <div class="modal-head">
          <span class="modal-title">📄 {{ sourceTitle }}</span>
          <button class="modal-close" @click="closeSource">✕</button>
        </div>
        <div class="source-body" v-html="sourceHtml"></div>
      </div>
    </div>
  </div>
</template>
