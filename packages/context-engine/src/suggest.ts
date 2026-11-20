import type { WorkspaceFacade } from "./workspace.js";
import type { RepoIndex } from "./repo-index.js";
import { langOf } from "./paths.js";

export interface MentionSuggestion {
  kind: "file" | "symbol";
  label: string;
  /** Text to insert after the "@". */
  insert: string;
  detail?: string | undefined;
  score: number;
}

/** In-order subsequence match score in [0,1]; 0 when `q` is not a subsequence of `s`. */
function subsequence(q: string, s: string): number {
  let i = 0;
  let last = -2;
  let run = 0;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) {
      run += last === j - 1 ? 2 : 1;
      last = j;
      i++;
    }
  }
  return i === q.length ? Math.min(1, run / (q.length * 2)) * 0.5 : 0;
}

export function scorePath(q: string, rel: string): number {
  const ql = q.toLowerCase();
  const rl = rel.toLowerCase();
  const base = rl.split("/").pop() ?? rl;
  if (!ql) return 0.1;
  if (base === ql) return 1;
  if (base.startsWith(ql)) return 0.9 - Math.min(0.1, base.length / 1000);
  if (base.includes(ql)) return 0.75;
  if (rl.includes(ql)) return 0.6;
  return subsequence(ql, rl);
}

/** Candidates for the composer's `@` picker: files by fuzzy path match, symbols by name (Tree-sitter). */
export async function suggestMentions(ws: WorkspaceFacade, index: RepoIndex, rawQuery: string, limit = 12, signal?: AbortSignal): Promise<MentionSuggestion[]> {
  const wantSymbol = rawQuery.startsWith("symbol:");
  const wantFile = rawQuery.startsWith("file:");
  const q = rawQuery.replace(/^(symbol|file):/, "");
  const out: MentionSuggestion[] = [];
  if (!wantSymbol) {
    for (const f of await ws.listFiles(signal)) {
      const s = scorePath(q, f);
      if (s > 0.2) out.push({ kind: "file", label: f, insert: f, score: s });
    }
  }
  if (!wantFile && q.length >= 2 && index.persistent && index.warmDone) {
    for (const s of index.persistent.search(q, limit * 3)) {
      if (s.kind === "variable") continue;
      const n = s.name.toLowerCase();
      const ql = q.toLowerCase();
      out.push({ kind: "symbol", label: `${s.container ? s.container + "." : ""}${s.name}`, insert: `symbol:${s.name}@${s.path}`, detail: `${s.kind} · ${s.path}:${s.startLine}`, score: (n === ql ? 1 : n.startsWith(ql) ? 0.85 : 0.65) * 0.95 });
    }
  } else if (!wantFile && q.length >= 2) {
    const files = (await ws.listFiles(signal)).filter((f) => langOf(f)).slice(0, 1500);
    const ql = q.toLowerCase();
    for (const f of files) {
      if (signal?.aborted) break;
      const fi = await index.file(f);
      if (!fi) continue;
      for (const s of fi.symbols) {
        const n = s.name.toLowerCase();
        const sc = n === ql ? 1 : n.startsWith(ql) ? 0.85 : n.includes(ql) ? 0.65 : 0;
        if (sc > 0 && s.kind !== "variable") out.push({ kind: "symbol", label: `${s.container ? s.container + "." : ""}${s.name}`, insert: `symbol:${s.name}@${f}`, detail: `${s.kind} · ${f}:${s.startLine}`, score: sc * 0.95 });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, limit);
}
