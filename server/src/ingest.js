/**
 * 知识入库脚本（支持增量）：
 *   node server/src/ingest.js            # 增量：只重算新增/变化/删除的文档
 *   node server/src/ingest.js --force    # 清空并全量重新入库
 *   MOCK_MODE=true node server/src/ingest.js   # 离线演示（哈希伪向量）
 *
 * 流程：读取 data/source/*.md|txt → 分段（500-800字，重叠100）→ 向量化 → 写入 vectors.json
 *
 * 增量逻辑：每个文档按内容 MD5 记录；入库时跳过内容未变化的文档（复用旧向量），
 * 仅对新增/修改的文档重新向量化，删除的文档自动从向量库清理。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

function fileHash(content) {
  return createHash('md5').update(content).digest('hex');
}

/** 读取当前所有源文档：{ text, source, doc, hash } */
function collectSources() {
  const files = readdirSync(config.paths.sourceDir).filter((f) => /\.(md|txt)$/i.test(f));
  const sources = [];
  for (const file of files) {
    const raw = readFileSync(path.join(config.paths.sourceDir, file), 'utf8');
    const chunks = splitIntoChunks(raw);
    const hash = fileHash(raw);
    chunks.forEach((text, i) => sources.push({ text, source: `${file}#片段${i + 1}`, doc: file, hash }));
    console.log(`  ${file}: ${chunks.length} 个片段`);
  }
  return sources;
}

const force = process.argv.includes('--force');
const existing = loadVectors();
const hasDocMeta = existing.chunks.every((c) => c.doc && c.hash);

console.log('读取知识库文档...');
const sources = collectSources();
if (!sources.length) {
  console.error(`未在 ${config.paths.sourceDir} 找到 .md/.txt 文档，请先放入设备手册/FAQ 文档`);
  process.exit(1);
}

// 组装本次入库的分片：增量（默认）或全量（--force）
let toEmbed = sources;
let keptChunks = [];
let added = sources.length;
let removed = 0;

if (!force && existing.chunks.length && hasDocMeta) {
  // 旧向量按文档分组
  const byDoc = {};
  for (const c of existing.chunks) {
    if (!byDoc[c.doc]) byDoc[c.doc] = { hash: c.hash, chunks: [] };
    byDoc[c.doc].chunks.push(c);
  }
  // 当前文档按文档去重分组（一个文档只处理一次）
  const curDocs = {};
  for (const s of sources) {
    if (!curDocs[s.doc]) curDocs[s.doc] = { hash: s.hash, chunks: [] };
    curDocs[s.doc].chunks.push(s);
  }
  // 内容未变化的文档：复用旧向量；变化/新增：重新向量化
  toEmbed = [];
  keptChunks = [];
  for (const [doc, info] of Object.entries(curDocs)) {
    const old = byDoc[doc];
    if (old && old.hash === info.hash) {
      keptChunks.push(...old.chunks);
    } else {
      toEmbed.push(...info.chunks);
    }
  }
  added = toEmbed.length;
  // 删除的文档：不在当前文档列表中 → 其旧向量自然被丢弃
  removed = Object.keys(byDoc).filter((d) => !curDocs[d]).length;
  console.log(`增量模式：复用 ${keptChunks.length} 条旧向量，新增/变化 ${added} 条，清理已删除文档 ${removed} 份`);
}

if (toEmbed.length) {
  console.log(`向量化 ${toEmbed.length} 个片段（${config.mock ? 'MOCK 伪向量' : config.embedding.provider + ':' + config.embedding.model}）...`);
  const embeddings = await embedTexts(toEmbed.map((s) => s.text));
  const newChunks = toEmbed.map((s, i) => ({ id: 0, ...s, embedding: embeddings[i] }));
  keptChunks = [...keptChunks, ...newChunks];
}

// 重新编号并落盘
const files = {};
for (const s of sources) files[s.doc] = s.hash;
const chunks = keptChunks.map((c, i) => ({ ...c, id: i + 1 }));
const store = {
  model: config.mock ? `mock:${config.embedding.model}` : `${config.embedding.provider}:${config.embedding.model}`,
  dim: chunks[0]?.embedding?.length || 0,
  files,
  chunks,
};
saveVectors(store);

const storePath = process.env.VECTOR_STORE === 'json' || !(await import('./store-sqlite.js')).available
  ? config.paths.vectorsFile
  : config.paths.dataDir + '/vectors.db';
console.log(`✅ 入库完成：共 ${store.chunks.length} 条（本次新增 ${added} 条）→ ${storePath}（向量维度 ${store.dim}）`);
