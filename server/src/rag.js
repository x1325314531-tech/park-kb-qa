import { embedTexts } from './embed.js';
import { retrieve } from './vector-store.js';
import { streamChat } from './llm.js';
import { config } from './config.js';

/**
 * RAG 主链路：向量化问题 → TopK 检索 → 拼 Prompt → 流式生成。
 * @returns {{ iterator: AsyncGenerator<string>, sources: Array<{source,text,score}>, total: number }}
 */
export async function ragStream(messages, options = {}) {
  const topK = options.topK || config.rag.topK;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const question = lastUser?.content || '';

  // 1) 问题向量化 + 检索
  const [queryVector] = await embedTexts([question]);
  const { hits, total } = retrieve(queryVector, { topK });

  // 2) 拼装系统提示词（含知识上下文与引用来源）
  const contexts = hits.map((h) => `【来源 ${h.source}】\n${h.text}`);
  const system = [
    '你是园区设备运维知识库问答助手，回答简洁、直接、可执行。',
    hits.length
      ? '请仅依据以下知识库内容回答：\n\n' + contexts.join('\n\n')
      : '当前未检索到相关知识库内容，请明确告知用户“知识库中未找到相关内容”，不要编造。',
    '回答末尾用一行“参考来源：”列出实际引用到的知识条目（文件名+片段编号）。',
  ].join('\n\n');

  // 3) 多轮历史裁剪（按字符预算，保留最近消息）
  let budget = config.rag.maxHistoryChars;
  const history = [];
  for (let i = messages.length - 1; i >= 0 && budget > 0; i--) {
    const m = messages[i];
    const cost = (m.content || '').length;
    if (cost > budget && history.length > 0) break;
    history.unshift(m);
    budget -= cost;
  }

  const iterator = streamChat({ system, messages: history });

  return {
    iterator,
    sources: hits.map((h) => ({ source: h.source, text: h.text, score: h.score })),
    total,
  };
}
