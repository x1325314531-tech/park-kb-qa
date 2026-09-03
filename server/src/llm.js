import { config } from './config.js';

/**
 * 流式调用 OpenAI 兼容的 /chat/completions 接口。
 * @returns {AsyncGenerator<string>} 逐段输出回答增量
 */
export async function* streamChat({ system, messages }) {
  // ---- MOCK 模式：离线演示，不调用任何 API ----
  if (config.mock) {
    const contextCount = (messages || []).length;
    const answer =
      '【MOCK 模式演示】已从知识库检索到相关上下文（本轮携带 ' +
      contextCount +
      ' 条历史消息）。配置 .env 中的 LLM_API_KEY 与 EMBEDDING_API_KEY 后，此处会调用 ' +
      config.llm.model +
      ' 实时生成带引用来源的流式回答。';
    for (let i = 0; i < answer.length; i += 6) {
      yield answer.slice(i, i + 6);
      await new Promise((r) => setTimeout(r, 25));
    }
    return;
  }

  if (!config.llm.apiKey) {
    throw new Error('缺少 LLM_API_KEY：请在 .env 配置对话模型 Key，或设置 MOCK_MODE=true 离线试跑');
  }

  const resp = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.llm.apiKey}`,
    },
    body: JSON.stringify({
      model: config.llm.model,
      messages: [{ role: 'system', content: system }, ...messages],
      stream: true,
      temperature: 0.3,
    }),
  });

  if (!resp.ok || !resp.body) {
    const body = await resp.text().catch(() => '');
    throw new Error(`LLM API ${resp.status}: ${body.slice(0, 200)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // 忽略无法解析的行（如 keep-alive）
      }
    }
  }
}
