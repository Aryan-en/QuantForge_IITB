import { createHash } from "node:crypto";
import { diffArrays } from "diff";
import { toDoc, fromArr, type Eol } from "./text.js";

export const CONTEXT = 3;

export interface HunkLine {
  kind: "context" | "add" | "del";
  text: string;
}

export interface Hunk {
  id: string;
  /** 0-based index into the base line array where oldLines start. */
  oldStart: number;
  oldLines: string[];
  newLines: string[];
  lead: number; // leading context line count
  trail: number; // trailing context line count
  lines: HunkLine[];
  added: number;
  removed: number;
}

interface Block {
  aStart: number;
  del: string[];
  add: string[];
}

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 12);
}

export function makeHunks(path: string, baseHash: string, baseText: string, newText: string): Hunk[] {
  const a = toDoc(baseText).arr;
  const b = toDoc(newText).arr;
  const parts = diffArrays(a, b);
  const blocks: Block[] = [];
  let ai = 0;
  let cur: Block | null = null;
  for (const p of parts) {
    if (!p.added && !p.removed) {
      cur = null;
      ai += p.value.length;
    } else {
      cur ??= (blocks[blocks.push({ aStart: ai, del: [], add: [] }) - 1] as Block);
      if (p.removed) {
        cur.del.push(...p.value);
        ai += p.value.length;
      } else cur.add.push(...p.value);
    }
  }
  const groups: Block[][] = [];
  for (const blk of blocks) {
    const g = groups[groups.length - 1];
    const last = g?.[g.length - 1];
    if (g && last && blk.aStart - (last.aStart + last.del.length) <= 2 * CONTEXT) g.push(blk);
    else groups.push([blk]);
  }
  return groups.map((g, index) => {
    const first = g[0]!;
    const last = g[g.length - 1]!;
    const oldStart = Math.max(0, first.aStart - CONTEXT);
    const oldEnd = Math.min(a.length, last.aStart + last.del.length + CONTEXT);
    const lines: HunkLine[] = [];
    const oldLines: string[] = [];
    const newLines: string[] = [];
    let pos = oldStart;
    let added = 0;
    let removed = 0;
    const emitCtx = (upTo: number): void => {
      for (; pos < upTo; pos++) {
        lines.push({ kind: "context", text: a[pos]! });
        oldLines.push(a[pos]!);
        newLines.push(a[pos]!);
      }
    };
    for (const blk of g) {
      emitCtx(blk.aStart);
      for (const t of blk.del) {
        lines.push({ kind: "del", text: t });
        oldLines.push(t);
        removed++;
      }
      pos += blk.del.length;
      for (const t of blk.add) {
        lines.push({ kind: "add", text: t });
        newLines.push(t);
        added++;
      }
    }
    emitCtx(oldEnd);
    return {
      id: sha1(`${path}|${baseHash}|${index}|${oldStart}`),
      oldStart,
      oldLines,
      newLines,
      lead: first.aStart - oldStart,
      trail: oldEnd - (last.aStart + last.del.length),
      lines,
      added,
      removed,
    };
  });
}

function matchesAt(cur: string[], at: number, pat: string[]): boolean {
  if (at < 0 || at + pat.length > cur.length) return false;
  for (let i = 0; i < pat.length; i++) if (cur[at + i] !== pat[i]) return false;
  return true;
}

/** Nearest index to `expected` (>= lower) where pat matches; -1 if none. */
function locate(cur: string[], pat: string[], expected: number, lower: number): number {
  const maxD = cur.length;
  for (let d = 0; d <= maxD; d++) {
    for (const at of d === 0 ? [expected] : [expected - d, expected + d]) {
      if (at >= lower && matchesAt(cur, at, pat)) return at;
    }
  }
  return -1;
}

export interface ApplyResult {
  text: string;
  applied: string[];
  conflicted: string[];
}

/**
 * Apply a subset of hunks (in base order) onto `currentText`, which may differ from the base the hunks were
 * computed against. Each hunk is located by content (nearest match), first with full context then with its
 * changed core only. A hunk that cannot be located is reported as conflicted and never forced.
 */
export function applyHunks(currentText: string, hunks: Hunk[]): ApplyResult {
  const doc = toDoc(currentText);
  let cur = doc.arr;
  const applied: string[] = [];
  const conflicted: string[] = [];
  let delta = 0;
  let lower = 0;
  for (const h of [...hunks].sort((x, y) => x.oldStart - y.oldStart)) {
    const expected = h.oldStart + delta;
    let at = locate(cur, h.oldLines, expected, lower);
    let oldPart = h.oldLines;
    let newPart = h.newLines;
    if (at < 0 && h.oldLines.length - h.lead - h.trail > 0) {
      oldPart = h.oldLines.slice(h.lead, h.oldLines.length - h.trail);
      newPart = h.newLines.slice(h.lead, h.newLines.length - h.trail);
      at = locate(cur, oldPart, expected + h.lead, lower);
    }
    if (at < 0) {
      conflicted.push(h.id);
      continue;
    }
    cur = [...cur.slice(0, at), ...newPart, ...cur.slice(at + oldPart.length)];
    delta += newPart.length - oldPart.length;
    lower = at + newPart.length;
    applied.push(h.id);
  }
  return { text: fromArr(cur, doc.eol as Eol), applied, conflicted };
}
