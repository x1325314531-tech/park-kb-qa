export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface SourceItem {
  source: string
  text: string
  score: number
}

export interface ChatHandlers {
  onDelta: (text: string) => void
  onSources: (sources: SourceItem[], total: number) => void
  onError: (message: string) => void
  onDone: () => void
}

/**
 * 调用后端 SSE 流式接口 POST /api/chat?top_k=N
 * 事件协议：
 *   event: delta   data: {"content":"..."}
 *   event: sources data: {"sources":[...],"total":N}
 *   event: error   data: {"message":"..."}
 *   event: done    data: {"usage":null}
 */
export async function chatStream(
  messages: ChatMessage[],
  handlers: ChatHandlers,
  topK = 5,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(`/api/chat?top_k=${topK}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  })

  if (!resp.ok || !resp.body) {
    const err = await resp.text().catch(() => `请求失败（HTTP ${resp.status}）`)
    handlers.onError(err)
    return
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const raw of events) {
      const lines = raw.split('\n')
      const event = lines.find((l) => l.startsWith('event:'))?.slice(6).trim() ?? ''
      const dataLine = lines.find((l) => l.startsWith('data:'))
      if (!dataLine) continue
      let data: Record<string, unknown>
      try {
        data = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>
      } catch {
        continue
      }
      if (event === 'delta') {
        handlers.onDelta(String(data.content ?? ''))
      } else if (event === 'sources') {
        handlers.onSources((data.sources as SourceItem[]) ?? [], Number(data.total ?? 0))
      } else if (event === 'error') {
        handlers.onError(String(data.message ?? '未知错误'))
      } else if (event === 'done') {
        handlers.onDone()
      }
    }
  }
}
