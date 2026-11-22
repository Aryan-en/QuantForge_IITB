import type { Proposal } from "@forge/diff-engine";

export interface ChecklistItem {
  requirement: string;
  evidence: string;
}
export interface Line {
  path: string;
  text: string;
  key: string;
}
export interface ItemResult {
  requirement: string;
  ok: boolean;
  reason?: string;
  path?: string;
}

const norm = (s: string): string => s.replace(/^\s*\d+\|\s?/, "").replace(/\s+/g, " ").trim().toLowerCase();
const tokens = (s: string): Set<string> => new Set(norm(s).match(/[a-z0-9_]{2,}/g) ?? []);

/** Lines a proposal ADDS (or, for deletions, REMOVES) — the only lines that can count as evidence. */
export function collectLines(proposals: Proposal[], kind: "add" | "del"): Line[] {
  const out: Line[] = [];
  for (const p of proposals) {
    p.hunks.forEach((h, hi) => h.lines.forEach((l, li) => {
      if (l.kind === kind && l.text.trim()) out.push({ path: p.path, text: l.text, key: `${p.id}:${hi}:${li}` });
    }));
  }
  return out;
}

function findLine(evidence: string, pool: Line[]): Line | null {
  const e = norm(evidence);
  if (e.length < 3) return null;
  for (const l of pool) {
    const n = norm(l.text);
    if (n.includes(e) || (n.length >= 12 && e.includes(n))) return l;
  }
  const et = tokens(evidence);
  if (et.size >= 3) {
    let best: { l: Line; f: number } | null = null;
    for (const l of pool) {
      const lt = tokens(l.text);
      let hit = 0;
      for (const t of et) if (lt.has(t)) hit++;
      const f = hit / et.size;
      if (f >= 0.8 && (!best || f > best.f)) best = { l, f };
    }
    if (best) return best.l;
  }
  return null;
}

/**
 * Model-agnostic completeness check: every requirement the agent lists must cite evidence that really appears among the
 * lines it ADDED (removed lines for "remove/delete" requirements), and no two requirements may share the same line — one
 * change cannot satisfy both "alter the behaviour" and "update the docs". A model that did half the task cannot pass.
 */
export function checkChecklist(checklist: ChecklistItem[], proposals: Proposal[]): { ok: boolean; results: ItemResult[] } {
  const added = collectLines(proposals, "add");
  const removed = collectLines(proposals, "del");
  const used = new Map<string, string>();
  const results: ItemResult[] = [];
  for (const item of checklist) {
    const wantsRemoval = /\b(remov|delet|drop|strip)/i.test(item.requirement);
    const hit = findLine(item.evidence, wantsRemoval ? [...removed, ...added] : added);
    if (!hit) {
      results.push({ requirement: item.requirement, ok: false, reason: "evidence is not among the lines you added — add the missing edit with propose_edit, or quote an exact added line" });
      continue;
    }
    const prev = used.get(hit.key);
    if (prev && prev !== item.requirement) {
      results.push({ requirement: item.requirement, ok: false, reason: `uses the same line as "${prev}" — each requirement needs its own change` });
      continue;
    }
    used.set(hit.key, item.requirement);
    results.push({ requirement: item.requirement, ok: true, path: hit.path });
  }
  return { ok: results.every((r) => r.ok), results };
}
