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
}

const messages = ref<DisplayMessage[]>([])
const input = ref('')
const streaming = ref(false)
const listEl = ref<HTMLElement | null>(null)
let abortCtrl: AbortController | null = null

const suggestions = [
  '中央空调高压报警怎么处理？',
  '电梯困人了怎么处置？',
  '消防主机误报怎么办？',
  '监控录像要保存多久？',
  '配电房停电了怎么办？',
]

function scrollToBottom() {
  void nextTick(() => {
    const el = listEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

async function send(text?: string) {
  const content = (text ?? input.value).trim()
  if (!content || streaming.value) return

  messages.value.push({ role: 'user', content, sources: [], total: 0 })
  const botIndex = messages.value.push({ role: 'assistant', content: '', sources: [], total: 0 }) - 1
  input.value = ''
  streaming.value = true
  scrollToBottom()

  const history: ChatMessage[] = messages.value.map((m) => ({ role: m.role, content: m.content }))

  abortCtrl = new AbortController()
  const signal = abortCtrl.signal

  try {
    await chatStream(
      history,
      {
        onDelta: (t) => {
          messages.value[botIndex].content += t
          scrollToBottom()
        },
        onSources: (sources, total) => {
          messages.value[botIndex].sources = sources
          messages.value[botIndex].total = total
        },
        onError: (msg) => {
          messages.value[botIndex].content = `⚠️ ${msg}`
          messages.value[botIndex].error = true
        },
        onDone: () => {
          if (!messages.value[botIndex].content) {
            messages.value[botIndex].content = '（没有生成回答内容）'
          }
        },
      },
      5,
      signal,
    )
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      messages.value[botIndex].content = `⚠️ ${(e as Error).message || '请求失败'}`
      messages.value[botIndex].error = true
    }
  } finally {
    streaming.value = false
    abortCtrl = null
    scrollToBottom()
  }
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
        <div class="bubble" :class="{ 'error-bubble': m.error }">{{ m.content }}
          <span v-if="streaming && i === messages.length - 1 && !m.content" class="typing">
            <span></span><span></span><span></span>
          </span>
        </div>

        <details v-if="m.role === 'assistant' && m.sources.length" class="sources">
          <summary>参考来源（{{ m.sources.length }} 条 / 知识库共 {{ m.total }} 条）</summary>
          <div class="list">
            <div v-for="(s, j) in m.sources" :key="j" class="source-card">
              <div class="src">📄 {{ s.source }}<span class="score">相似度 {{ s.score }}</span></div>
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
  </div>
</template>
