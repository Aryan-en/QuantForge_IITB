import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { FileIndex, SymbolInfo } from "./types.js";

/** Minimal surface of node:sqlite's DatabaseSync that we use (the module is optional and loaded dynamically). */
interface Db {
  exec(sql: string): void;
  prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): any; all(...a: unknown[]): any[] };
  close(): void;
}

/**
 * Tier-1 persistent symbol index: SQLite + FTS5 via Node's built-in `node:sqlite` (no native addon to rebuild per Electron ABI).
 * Optional: `open()` returns null when `node:sqlite`/FTS5 is unavailable and callers fall back to the on-demand index.
 * Rows are keyed by path and validated by (mtime,size), so stale entries are never served.
 */
export class SqliteSymbolIndex {
  private constructor(private readonly db: Db) {}

  static open(file: string): SqliteSymbolIndex | null {
    try {
      const req = createRequire(import.meta.url);
      const { DatabaseSync } = req("node:sqlite") as { DatabaseSync: new (p: string) => Db };
      if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
      const db = new DatabaseSync(file);
      db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, mtime REAL NOT NULL, size INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS sym USING fts5(name, container, path UNINDEXED, kind UNINDEXED, startLine UNINDEXED, endLine UNINDEXED, signature UNINDEXED, tokenize='unicode61 remove_diacritics 2');`);
      return new SqliteSymbolIndex(db);
    } catch {
      return null;
    }
  }

  /** Cached parse for `path` if the file has not changed since it was indexed. */
  get(rel: string, mtimeMs: number, size: number): FileIndex | null {
    const row = this.db.prepare("SELECT data FROM files WHERE path=? AND mtime=? AND size=?").get(rel, mtimeMs, size);
    return row ? (JSON.parse(row.data as string) as FileIndex) : null;
  }

  upsert(fi: FileIndex): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM sym WHERE path=?").run(fi.path);
      this.db.prepare("INSERT OR REPLACE INTO files(path,mtime,size,data) VALUES(?,?,?,?)").run(fi.path, fi.mtimeMs, fi.size, JSON.stringify(fi));
      const ins = this.db.prepare("INSERT INTO sym(name,container,path,kind,startLine,endLine,signature) VALUES(?,?,?,?,?,?,?)");
      for (const s of fi.symbols) ins.run(s.name, s.container ?? "", s.path, s.kind, s.startLine, s.endLine, s.signature);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  remove(rel: string): void {
    this.db.prepare("DELETE FROM files WHERE path=?").run(rel);
    this.db.prepare("DELETE FROM sym WHERE path=?").run(rel);
  }

  /** Prefix/token search over symbol names (and containers), best matches first. */
  search(query: string, limit = 20): SymbolInfo[] {
    const tokens = query.toLowerCase().match(/[a-z0-9_]+/g);
    if (!tokens?.length) return [];
    const match = tokens.map((t) => `"${t}"*`).join(" ");
    const rows = this.db.prepare("SELECT name,container,path,kind,startLine,endLine,signature, bm25(sym) AS r FROM sym WHERE sym MATCH ? ORDER BY r LIMIT ?").all(`{name container} : ${match}`, limit);
    return rows.map((r) => ({ name: r.name, container: r.container || undefined, path: r.path, kind: r.kind, startLine: r.startLine, endLine: r.endLine, signature: r.signature }));
  }

  stats(): { files: number; symbols: number } {
    return { files: this.db.prepare("SELECT count(*) c FROM files").get().c, symbols: this.db.prepare("SELECT count(*) c FROM sym").get().c };
  }

  close(): void {
    this.db.close();
  }
}
