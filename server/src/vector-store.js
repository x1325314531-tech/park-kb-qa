/**
 * 向量存储层门面：按 VECTOR_STORE 环境变量分发（默认 sqlite-vec，可回退 JSON）。
 *   VECTOR_STORE=sqlite   → server/data/vectors.db（sqlite-vec KNN，推荐，需 npm install）
 *   VECTOR_STORE=json     → server/data/vectors.json（零依赖回退）
 * 未安装 sqlite-vec 依赖时自动回退 JSON 并给出提示。
 */
import * as jsonStore from './store-json.js';
import * as sqliteStore from './store-sqlite.js';

const want = (process.env.VECTOR_STORE || 'sqlite').toLowerCase();
const useSqlite = want === 'sqlite' && sqliteStore.available;

if (want === 'sqlite' && !sqliteStore.available) {
  console.warn('[vector-store] 未检测到 better-sqlite3/sqlite-vec，已回退 JSON 存储（执行 npm install 后自动切换 SQLite）。');
}

export const loadVectors = (...args) => (useSqlite ? sqliteStore : jsonStore).loadVectors(...args);
export const saveVectors = (...args) => (useSqlite ? sqliteStore : jsonStore).saveVectors(...args);
export const retrieve = (...args) => (useSqlite ? sqliteStore : jsonStore).retrieve(...args);
