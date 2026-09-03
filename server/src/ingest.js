/**
 * 知识入库脚本：
 *   node server/src/ingest.js            # 真实模式（需要 EMBEDDING_API_KEY）
 *   node server/src/ingest.js --force    # 清空并重新入库
 *   MOCK_MODE=true node server/src/ingest.js   # 离线演示（哈希伪向量）
 *
 * 流程：读取 data/source/*.md|txt → 分段（500-800字，重叠100）→ 向量化 → 写入 vectors.json
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { embedTexts } from './embed.js';
import { loadVectors, saveVectors } from './vector-store.js';

/** 简单分块：按空行聚合段落，目标 500-800 字，尾部重叠 100 字 */
function splitIntoChunks(text, { min = 500, max = 800, overlap = 100 } = {}) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks = [];
  let buf = '';
  for (const p of paragraphs) {
    if (buf && buf.length + p.length + 1 > max) {
      chunks.push(buf.trim());
      buf = buf.slice(-overlap) + '\n' + p;
    } else {
      buf = buf ? buf + '\n' + p : p;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

function collectSources() {
  const files = readdirSync(config.paths.sourceDir).filter((f) => /\.(md|txt)$/i.test(f));
  const sources = [];
  for (const file of files) {
    const raw = readFileSync(path.join(config.paths.sourceDir, file), 'utf8');
    const chunks = splitIntoChunks(raw);
    chunks.forEach((text, i) => sources.push({ text, source: `${file}#片段${i + 1}` }));
    console.log(`  ${file}: ${chunks.length} 个片段`);
  }
  return sources;
}

const force = process.argv.includes('--force');
const existing = loadVectors();
if (!force && existing.chunks.length) {
  console.log(`向量库已存在（${existing.chunks.length} 条，model=${existing.model || 'mock'}）。需要重建请加 --force`);
  process.exit(0);
}

console.log('读取知识库文档...');
const sources = collectSources();
if (!sources.length) {
  console.error(`未在 ${config.paths.sourceDir} 找到 .md/.txt 文档，请先放入设备手册/FAQ 文档`);
  process.exit(1);
}

console.log(`共 ${sources.length} 个片段，开始向量化（${config.mock ? 'MOCK 伪向量' : config.embedding.provider + ':' + config.embedding.model}）...`);
const embeddings = await embedTexts(sources.map((s) => s.text));

const store = {
  model: config.mock ? `mock:${config.embedding.model}` : `${config.embedding.provider}:${config.embedding.model}`,
  dim: embeddings[0]?.length || 0,
  chunks: sources.map((s, i) => ({ id: i + 1, ...s, embedding: embeddings[i] })),
};
saveVectors(store);

console.log(`✅ 入库完成：${store.chunks.length} 条 → ${config.paths.vectorsFile}（向量维度 ${store.dim}）`);
