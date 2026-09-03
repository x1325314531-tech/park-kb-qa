import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(SERVER_DIR, '..');

/** 极简 .env 加载器（零依赖）：不覆盖已存在的环境变量 */
function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const content = readFileSync(file, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(PROJECT_ROOT, '.env'));
loadEnvFile(path.join(SERVER_DIR, '.env'));

const stripSlash = (s) => (s || '').replace(/\/+$/, '');

export const config = {
  port: Number(process.env.PORT || 3001),
  /** 未配置 LLM Key 或 MOCK_MODE=true 时进入离线演示模式 */
  mock: process.env.MOCK_MODE === 'true' || !process.env.LLM_API_KEY,
  llm: {
    baseUrl: stripSlash(process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1'),
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'deepseek-chat',
  },
  embedding: {
    provider: (process.env.EMBEDDING_PROVIDER || 'siliconflow').toLowerCase(),
    baseUrl: stripSlash(process.env.EMBEDDING_BASE_URL || 'https://api.siliconflow.cn/v1'),
    apiKey: process.env.EMBEDDING_API_KEY || '',
    model: process.env.EMBEDDING_MODEL || 'BAAI/bge-m3',
  },
  rag: {
    topK: Number(process.env.RAG_TOP_K || 5),
    threshold: Number(process.env.RAG_THRESHOLD || 0.1),
    maxHistoryChars: Number(process.env.RAG_MAX_HISTORY_CHARS || 4000),
  },
  paths: {
    sourceDir: path.join(SERVER_DIR, 'data', 'source'),
    dataDir: path.join(SERVER_DIR, 'data'),
    vectorsFile: path.join(SERVER_DIR, 'data', 'vectors.json'),
  },
};

export function assertEmbeddingReady() {
  if (config.mock) return;
  if (!config.embedding.apiKey) {
    throw new Error(
      '缺少 EMBEDDING_API_KEY：请在 .env 配置向量模型 Key（SiliconFlow/通义/OpenAI 任选），或设置 MOCK_MODE=true 离线试跑'
    );
  }
}
