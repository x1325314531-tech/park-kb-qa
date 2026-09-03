/**
 * SQLite 向量存储（sqlite-vec）：
 *   - vec0 虚拟表做余弦 KNN 检索（sqlite-vec 扩展）
 *   - chunks_meta 普通表存文本元数据 + embedding 的 JSON 副本（供增量入库复用）
 *   - store_meta 存 model/dim/files 元信息
 *
 * 单文件落盘 server/data/vectors.db，无需外部服务；依赖 better-sqlite3 + sqlite-vec。
 * 未安装依赖时 available=false，上层自动回退 JSON 存储。
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { config } from './config.js';

const require = createRequire(import.meta.url);

let Database = null;
let sqliteVec = null;
try {
  Database = require('better-sqlite3');
  sqliteVec = require('sqlite-vec');
} catch {
  /* 依赖未安装 → available=false，上层回退 JSON */
}

export const available = !!(Database && sqliteVec);

let db = null;
let tableDim = 0;

function dbPath() {
  return path.join(config.paths.dataDir, 'vectors.db');
}

function open() {
  if (db) return db;
  if (!available) throw new Error('better-sqlite3 / sqlite-vec 未安装，请先执行 npm install');
  mkdirSync(config.paths.dataDir, { recursive: true });
  db = new Database(dbPath());
  db.pragma('journal_mode = WAL');
  sqliteVec.load(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS chunks_meta (
      id             INTEGER PRIMARY KEY,
      text           TEXT NOT NULL,
      source         TEXT NOT NULL,
      doc            TEXT NOT NULL,
      hash           TEXT NOT NULL,
      embedding_json TEXT NOT NULL
    );
  `);
  const dimRow = db.prepare(`SELECT value FROM store_meta WHERE key = 'dim'`).get();
  ensureVecTable(dimRow ? Number(dimRow.value) : 1024);
  return db;
}

/** vec0 维度变化时重建虚拟表 */
function ensureVecTable(dim) {
  const safeDim = Math.max(1, Math.min(8192, Math.floor(dim) || 1024));
  if (tableDim === safeDim) return;
  db.exec(`DROP TABLE IF EXISTS chunks_vec`);
  db.exec(`CREATE VIRTUAL TABLE chunks_vec USING vec0(embedding float[${safeDim}] distance_metric=cosine)`);
  tableDim = safeDim;
}

export function loadVectors() {
  const d = open();
  const meta = {};
  for (const row of d.prepare(`SELECT key, value FROM store_meta`).all()) meta[row.key] = row.value;
  const rows = d
    .prepare(`SELECT id, text, source, doc, hash, embedding_json FROM chunks_meta ORDER BY id`)
    .all();
  const chunks = rows.map((r) => ({
    id: r.id,
    text: r.text,
    source: r.source,
    doc: r.doc,
    hash: r.hash,
    embedding: JSON.parse(r.embedding_json),
  }));
  return {
    model: meta.model || '',
    dim: Number(meta.dim || 0),
    files: JSON.parse(meta.files || '{}'),
    chunks,
  };
}

export function saveVectors(store) {
  const d = open();
  ensureVecTable(store.dim || 1024);
  const tx = d.transaction((s) => {
    d.exec(`DELETE FROM chunks_vec; DELETE FROM chunks_meta;`);
    const insMeta = d.prepare(
      `INSERT INTO chunks_meta (id, text, source, doc, hash, embedding_json) VALUES (?, ?, ?, ?, ?, ?)`
    );
    const insVec = d.prepare(`INSERT INTO chunks_vec (embedding) VALUES (?)`);
    for (const c of s.chunks) {
      insMeta.run(c.id, c.text, c.source, c.doc || '', c.hash || '', JSON.stringify(c.embedding));
      insVec.run(new Float32Array(c.embedding));
    }
    const upsert = d.prepare(
      `INSERT INTO store_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
    upsert.run('model', s.model || '');
    upsert.run('dim', String(s.dim || 0));
    upsert.run('files', JSON.stringify(s.files || {}));
  });
  tx(store);
}

/**
 * sqlite-vec 余弦 KNN 检索（与 JSON 版 cosine TopK 结果一致：score = 1 - cosine_distance）
 * @returns {{ hits: Array<{id,text,source,score}>, total: number }}
 */
export function retrieve(queryVector, { topK = config.rag.topK, threshold = config.rag.threshold } = {}) {
  const d = open();
  const { n: total } = d.prepare(`SELECT COUNT(*) n FROM chunks_meta`).get();
  if (!total) return { hits: [], total: 0 };
  const k = Math.max(topK * 4, topK, 1);
  const rows = d
    .prepare(`SELECT rowid, distance FROM chunks_vec WHERE embedding MATCH ? AND k = ?`)
    .all(JSON.stringify(queryVector), k);
  if (!rows.length) return { hits: [], total };
  const ids = rows.map((r) => r.rowid);
  const metas = d
    .prepare(`SELECT id, text, source FROM chunks_meta WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids);
  const byId = new Map(metas.map((m) => [m.id, m]));
  const hits = rows
    .map((r) => {
      const m = byId.get(r.rowid);
      if (!m) return null;
      return { id: r.rowid, text: m.text, source: m.source, score: Number((1 - r.distance).toFixed(4)) };
    })
    .filter((h) => h && h.score >= threshold)
    .slice(0, topK);
  return { hits, total };
}
