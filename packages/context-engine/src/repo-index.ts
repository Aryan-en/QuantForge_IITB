import type { FileIndex, SymbolInfo } from "./types.js";
import type { SqliteSymbolIndex } from "./sqlite-index.js";
import { parseFile } from "./parser.js";
import type { WorkspaceFacade } from "./workspace.js";
import { langOf } from "./paths.js";

/** On-demand index (Tier 0): per-file parse cached by mtime+size. No persistence required. */
export class RepoIndex {
  private cache = new Map<string, FileIndex>();
  private store: SqliteSymbolIndex | null = null;
  /** Counters for diagnostics/tests: how many files were parsed vs served from the persistent store. */
  readonly stats = { parsed: 0, fromStore: 0 };
  /** True once a full warm() pass completed, i.e. the persistent index covers the whole workspace and can answer searches alone. */
  warmDone = false;
  constructor(readonly ws: WorkspaceFacade) {}

  /** Attach the optional persistent SQLite index (Tier 1). Parsing results are written through; fresh rows are read back. */
  attachStore(store: SqliteSymbolIndex | null): void {
    this.store = store;
  }
  get persistent(): SqliteSymbolIndex | null {
    return this.store;
  }

  async file(rel: string): Promise<FileIndex | null> {
    const st = await this.ws.stat(rel);
    if (!st) return null;
    const hit = this.cache.get(rel);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    let stored: FileIndex | null = null;
    try { stored = this.store?.get(rel, st.mtimeMs, st.size) ?? null; } catch { this.store = null; } // a broken optional index must never break reads
    if (stored) {
      this.cache.set(rel, stored);
      this.stats.fromStore++;
      return stored;
    }
    const text = await this.ws.readFile(rel);
    if (text === null) return null;
    const fi = await parseFile(rel, text, st);
    this.stats.parsed++;
    this.cache.set(rel, fi);
    try { this.store?.upsert(fi); } catch { /* index is an optimisation; never fail a read because of it */ }
    return fi;
  }

  invalidate(rel?: string): void {
    if (rel) this.cache.delete(rel);
    else this.cache.clear();
  }

  /** A file was deleted or renamed away. */
  remove(rel: string): void {
    this.cache.delete(rel);
    try { this.store?.remove(rel); } catch { /* ignore */ }
  }

  /** Parse every supported source file (used for small repos / index warm-up). */
  async warm(limit = 4000, signal?: AbortSignal): Promise<number> {
    const files = (await this.ws.listFiles(signal)).filter((f) => langOf(f)).slice(0, limit);
    let n = 0;
    for (const f of files) {
      if (signal?.aborted) break;
      if (await this.file(f)) n++;
    }
    if (!signal?.aborted && files.length < limit) this.warmDone = true;
    return n;
  }

  /** Find definitions by name: ripgrep narrows candidate files, Tree-sitter confirms. */
  async symbolsNamed(name: string, opts: { kind?: string | undefined; path?: string | undefined; signal?: AbortSignal | undefined } = {}): Promise<SymbolInfo[]> {
    const wanted = name.split(".").pop() ?? name;
    let candidates: string[];
    if (opts.path) candidates = [opts.path];
    else {
      const r = await this.ws.search({ query: wanted, wholeWord: true, caseSensitive: true, maxPerFile: 3, maxTotal: 600, signal: opts.signal });
      candidates = [...new Set(r.matches.map((m) => m.path))].filter((p) => langOf(p)).slice(0, 80);
    }
    const out: SymbolInfo[] = [];
    for (const c of candidates) {
      const fi = await this.file(c);
      if (!fi) continue;
      for (const s of fi.symbols) {
        if (s.name !== wanted) continue;
        if (opts.kind && opts.kind !== "any" && s.kind !== opts.kind && !(opts.kind === "function" && s.kind === "method")) continue;
        out.push(s);
      }
    }
    return out;
  }
}
