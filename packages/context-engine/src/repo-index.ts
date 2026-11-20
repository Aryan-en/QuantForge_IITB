import type { FileIndex, SymbolInfo } from "./types.js";
import { parseFile } from "./parser.js";
import type { WorkspaceFacade } from "./workspace.js";
import { langOf } from "./paths.js";

/** On-demand index (Tier 0): per-file parse cached by mtime+size. No persistence required. */
export class RepoIndex {
  private cache = new Map<string, FileIndex>();
  constructor(readonly ws: WorkspaceFacade) {}

  async file(rel: string): Promise<FileIndex | null> {
    const st = await this.ws.stat(rel);
    if (!st) return null;
    const hit = this.cache.get(rel);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    const text = await this.ws.readFile(rel);
    if (text === null) return null;
    const fi = await parseFile(rel, text, st);
    this.cache.set(rel, fi);
    return fi;
  }

  invalidate(rel?: string): void {
    if (rel) this.cache.delete(rel);
    else this.cache.clear();
  }

  /** Parse every supported source file (used for small repos / index warm-up). */
  async warm(limit = 4000, signal?: AbortSignal): Promise<number> {
    const files = (await this.ws.listFiles(signal)).filter((f) => langOf(f)).slice(0, limit);
    let n = 0;
    for (const f of files) {
      if (signal?.aborted) break;
      if (await this.file(f)) n++;
    }
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
