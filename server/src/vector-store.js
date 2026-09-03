import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function loadVectors() {
  if (!existsSync(config.paths.vectorsFile)) return { model: '', dim: 0, chunks: [] };
  try {
    return JSON.parse(readFileSync(config.paths.vectorsFile, 'utf8'));
  } catch {
    return { model: '', dim: 0, chunks: [] };
  }
}

export function saveVectors(store) {
  mkdirSync(path.dirname(config.paths.vectorsFile), { recursive: true });
  writeFileSync(config.paths.vectorsFile, JSON.stringify(store), 'utf8');
}

/**
 * 余弦相似度 TopK 检索
 * @returns {{ hits: Array<{id,text,source,score}>, total: number }}
 */
export function retrieve(queryVector, { topK = config.rag.topK, threshold = config.rag.threshold } = {}) {
  const store = loadVectors();
  if (!store.chunks.length) return { hits: [], total: 0 };
  const scored = store.chunks
    .map((chunk) => ({ ...chunk, score: cosine(queryVector, chunk.embedding) }))
    .sort((a, b) => b.score - a.score);
  const hits = scored
    .filter((item) => item.score >= threshold)
    .slice(0, topK)
    .map(({ id, text, source, score }) => ({ id, text, source, score: Number(score.toFixed(4)) }));
  return { hits, total: store.chunks.length };
}
