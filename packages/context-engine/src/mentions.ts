import type { Mention } from "@forge/protocol";
import type { WorkspaceFacade } from "./workspace.js";
import type { RepoIndex } from "./repo-index.js";

export interface ParsedMentions {
  mentions: Mention[];
  /** Query text with mention tokens removed. */
  text: string;
}

/** Supports `@file:path`, `@symbol:Name` (optionally `@symbol:Name@path`), and `@path/with.ext` shorthand. */
export function parseMentions(input: string): ParsedMentions {
  const mentions: Mention[] = [];
  let text = input;
  text = text.replace(/@symbol:([A-Za-z_][\w.$]*)(?:@([^\s]+))?/g, (_m, name: string, p?: string) => {
    mentions.push(p ? { kind: "symbol", name, path: p } : { kind: "symbol", name });
    return name;
  });
  text = text.replace(/@file:([^\s]+)/g, (_m, p: string) => {
    mentions.push({ kind: "file", path: p });
    return p;
  });
  text = text.replace(/(^|\s)@([\w./\-]+\.[A-Za-z0-9]+)(?=[\s,.;:!?)]|$)/g, (_m, pre: string, p: string) => {
    mentions.push({ kind: "file", path: p });
    return `${pre}${p}`;
  });
  return { mentions, text };
}

export interface ResolvedMention {
  mention: Mention;
  path: string;
  /** For symbol mentions, the definition range. */
  range?: { startLine: number; endLine: number };
  label: string;
}

export async function resolveMentions(ws: WorkspaceFacade, index: RepoIndex, mentions: Mention[]): Promise<{ resolved: ResolvedMention[]; errors: string[] }> {
  const resolved: ResolvedMention[] = [];
  const errors: string[] = [];
  const files = new Set(await ws.listFiles());
  for (const m of mentions) {
    if (m.kind === "file") {
      const p = m.path.replace(/^\.\//, "");
      if (files.has(p)) resolved.push({ mention: m, path: p, label: `@file ${p}` });
      else {
        const cand = [...files].filter((f) => f.endsWith(`/${p}`) || f === p);
        if (cand.length === 1) resolved.push({ mention: m, path: cand[0]!, label: `@file ${cand[0]}` });
        else errors.push(cand.length > 1 ? `@file ${p} is ambiguous (${cand.slice(0, 3).join(", ")})` : `@file ${p} was not found`);
      }
    } else {
      const syms = await index.symbolsNamed(m.name, { path: m.path });
      if (syms.length === 0) errors.push(`@symbol ${m.name} was not found`);
      for (const s of syms.slice(0, 5)) resolved.push({ mention: m, path: s.path, range: { startLine: s.startLine, endLine: s.endLine }, label: `@symbol ${s.container ? s.container + "." : ""}${s.name}` });
    }
  }
  return { resolved, errors };
}
