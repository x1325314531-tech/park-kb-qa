import { config, assertEmbeddingReady } from './config.js';

const MOCK_DIM = 64;

/**
 * MOCK 模式：基于文本哈希生成确定性伪向量。
 * 同一文本永远得到同一向量 → 无需 API 也能验证「入库→检索→问答」完整链路。
 */
function hashEmbedding(text) {
  const vec = new Array(MOCK_DIM).fill(0);
  let seed = 0;
  for (let i = 0; i < text.length; i++) {
    seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const slot = ((code * 2654435761) >>> 0) % MOCK_DIM;
    vec[slot] += (code % 7) + 1 + (seed % 3);
  }
  let norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  for (let i = 0; i < MOCK_DIM; i++) vec[i] /= norm;
  return vec;
}

/** OpenAI 兼容 /embeddings 接口（SiliconFlow / OpenAI 等） */
async function embedViaOpenAICompatible(texts) {
  const resp = await fetch(`${config.embedding.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.embedding.apiKey}`,
    },
    body: JSON.stringify({ model: config.embedding.model, input: texts }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Embedding API ${resp.status}: ${body.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

/** 阿里云百炼 DashScope text-embedding 接口 */
async function embedViaDashScope(texts) {
  const resp = await fetch(
    'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.embedding.apiKey}`,
      },
      body: JSON.stringify({
        model: config.embedding.model || 'text-embedding-v3',
        input: texts,
      }),
    }
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`DashScope Embedding ${resp.status}: ${body.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.output.embeddings.map((item) => item.embedding);
}

/** 批量向量化；MOCK 模式下返回伪向量 */
export async function embedTexts(texts) {
  if (config.mock) return texts.map(hashEmbedding);
  assertEmbeddingReady();
  if (config.embedding.provider === 'dashscope') return embedViaDashScope(texts);
  return embedViaOpenAICompatible(texts);
}

export const mockDim = MOCK_DIM;
