import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { assembleContext, renderBundle, estimateTokens } from "@forge/context-engine";
import { contentHash, ProposeError } from "@forge/diff-engine";
import {
  fail, ReadFileInput, SearchWorkspaceInput, FindSymbolInput, GetFileStructureInput, GetContextInput, ProposeEditInput,
  SubmitChangesInput, RunTerminalInput, GetDiagnosticsInput, GetGitStatusInput, UpdatePlanInput, type ToolFailure,
} from "@forge/protocol";
import type { Handler, ToolContext } from "./context.js";
import { isFailure, looksBinary, resolveWorkspacePath, truncate } from "./safety.js";
import { evaluateCommand } from "./policy.js";
import { runProcess, scrubbedEnv } from "./terminal.js";

const MAX_READ_BYTES = 512 * 1024;

function numbered(lines: string[], start: number): string {
  const w = String(start + lines.length - 1).length;
  return lines.map((l, i) => `${String(start + i).padStart(w, " ")}| ${l}`).join("\n");
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  description: string;
  schema: S;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  handler: Handler<z.infer<S>>;
}
const def = <S extends z.ZodType>(d: ToolDef<S>): ToolDef<S> => d;

// ------------------------------------------------------------------ read_file
const read_file = def({
  name: "read_file",
  title: "Read file",
  description:
    "Read a workspace file (or a line range). Returns numbered lines `N| text` — the `N| ` prefix is NOT part of the file; never include it in edits. Also returns `contentHash` (pass it as baseHash to propose_edit). If the file has a pending proposal you see the PROPOSED content (fromProposal:true).",
  schema: ReadFileInput,
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler(input, ctx) {
    const r = await resolveWorkspacePath(ctx.root, input.path, { mustExist: false });
    if (isFailure(r)) return r;
    const eff = await ctx.review.effectiveText(r.rel);
    let text = eff.text;
    if (text === null) return fail("NOT_FOUND", `${r.rel} does not exist`, "use search_workspace or get_file_structure to find the right path");
    if (!eff.fromProposal) {
      const st = await fs.stat(r.abs);
      if (st.isDirectory()) return fail("INVALID_INPUT", `${r.rel} is a directory; use get_file_structure`);
      if (st.size > MAX_READ_BYTES && !input.range) return fail("TOO_LARGE", `${r.rel} is ${st.size} bytes`, "pass a range, e.g. {startLine:1,endLine:200}, or use get_file_structure first");
      const buf = await fs.readFile(r.abs);
      if (looksBinary(buf)) return fail("DENIED", `${r.rel} looks like a binary file`);
      text = buf.toString("utf8");
    }
    const all = text.replace(/\r\n/g, "\n").split("\n");
    if (all[all.length - 1] === "") all.pop();
    const total = all.length;
    const start = input.range?.startLine ?? 1;
    let end = Math.min(input.range?.endLine ?? total, total);
    if (start > total && total > 0) return fail("INVALID_INPUT", `startLine ${start} is past the end of the file (${total} lines)`);
    let slice = all.slice(start - 1, end);
    let body = numbered(slice, start);
    let truncated = false;
    if (body.length > ctx.limits.maxOutputChars || slice.length > 2000) {
      const t = truncate(body, ctx.limits.maxOutputChars);
      const keep = t.text.split("\n");
      keep.pop();
      slice = slice.slice(0, Math.min(keep.length, 2000));
      end = start + slice.length - 1;
      body = numbered(slice, start);
      truncated = true;
    }
    return {
      ok: true, path: r.rel, content: body, totalLines: total, range: { startLine: start, endLine: end }, encoding: "utf8", truncated,
      contentHash: contentHash(text), fromProposal: eff.fromProposal,
      ...(truncated ? { hint: `output truncated; continue with range {startLine:${end + 1}}` } : {}),
    };
  },
});

// ------------------------------------------------------------------ search_workspace
const search_workspace = def({
  name: "search_workspace",
  title: "Search workspace",
  description: "Search file contents with ripgrep (fixed string by default; regex:true for regex). Respects .gitignore and the exclusion settings. Use find_symbol for definitions.",
  schema: SearchWorkspaceInput,
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler(input, ctx, signal) {
    const max = input.maxResults ?? 50;
    try {
      const r = await ctx.ws.search({ query: input.query, regex: input.regex ?? false, caseSensitive: input.caseSensitive ?? false, globs: input.glob, maxTotal: max + 1, maxPerFile: 20, signal });
      const matches = r.matches.slice(0, max).map((m) => ({ path: m.path, line: m.line, preview: m.text.slice(0, 200) }));
      return { ok: true, matches, count: matches.length, truncated: r.matches.length > max || r.truncated, ...(r.timedOut ? { warning: "search timed out; results are partial" } : {}) };
    } catch (e) {
      if (signal.aborted) return fail("CANCELLED", "search cancelled");
      return fail("INVALID_INPUT", (e as Error).message, input.regex ? "check the regular expression" : undefined);
    }
  },
});

// ------------------------------------------------------------------ find_symbol
const find_symbol = def({
  name: "find_symbol",
  title: "Find symbol",
  description: "Locate definitions of a function/class/method/variable by name (Tree-sitter, Python and TypeScript/JavaScript). Optionally list textual references. An empty result is not an error.",
  schema: FindSymbolInput,
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler(input, ctx, signal) {
    let scope: string | undefined;
    if (input.path) {
      const r = await resolveWorkspacePath(ctx.root, input.path, { mustExist: true });
      if (isFailure(r)) return r;
      scope = r.rel;
    }
    const syms = await ctx.index.symbolsNamed(input.name, { kind: input.kind, path: scope, signal });
    const out: Record<string, unknown> = {
      ok: true,
      symbols: syms.slice(0, 50).map((s) => ({ name: s.name, kind: s.kind, path: s.path, range: { startLine: s.startLine, endLine: s.endLine }, signature: s.signature, container: s.container, doc: s.doc })),
    };
    if (input.includeReferences) {
      const wanted = input.name.split(".").pop()!;
      const r = await ctx.ws.search({ query: wanted, wholeWord: true, caseSensitive: true, maxTotal: 80, maxPerFile: 10, signal });
      out.references = r.matches.map((m) => ({ path: m.path, line: m.line, preview: m.text.trim().slice(0, 160) }));
    }
    return out;
  },
});

// ------------------------------------------------------------------ get_file_structure
const get_file_structure = def({
  name: "get_file_structure",
  title: "File or directory structure",
  description: "For a file: its symbols (with line ranges) and imports. For a directory: its entries up to `depth` levels. Use before reading large files.",
  schema: GetFileStructureInput,
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler(input, ctx) {
    const r = await resolveWorkspacePath(ctx.root, input.path, { mustExist: true });
    if (isFailure(r)) return r;
    const st = await fs.stat(r.abs);
    if (st.isDirectory()) {
      const depth = input.depth ?? 2;
      const prefix = r.rel === "." ? "" : `${r.rel}/`;
      const files = (await ctx.ws.listFiles()).filter((f) => f.startsWith(prefix));
      const entries = new Map<string, { type: "file" | "dir"; files?: number }>();
      for (const f of files) {
        const parts = f.slice(prefix.length).split("/");
        const cut = parts.slice(0, depth);
        const isDir = parts.length > depth;
        const key = (isDir ? cut.join("/") : f.slice(prefix.length));
        const cur = entries.get(key);
        if (isDir) entries.set(key, { type: "dir", files: (cur?.files ?? 0) + 1 });
        else entries.set(key, { type: "file" });
      }
      const list = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 300).map(([p, v]) => ({ path: prefix + p, ...v }));
      return { ok: true, kind: "directory", entries: list, truncated: entries.size > 300 };
    }
    const fi = await ctx.index.file(r.rel);
    if (!fi) return fail("NOT_FOUND", `${r.rel} could not be read`);
    return {
      ok: true, kind: "file", path: r.rel, lineCount: fi.lineCount, parsed: fi.lang !== null, language: fi.lang,
      symbols: fi.symbols.map((s) => ({ name: s.name, kind: s.kind, range: { startLine: s.startLine, endLine: s.endLine }, signature: s.signature, container: s.container })),
      imports: fi.imports.map((i) => `${".".repeat(i.level)}${i.module}${i.names.length ? ` (${i.names.join(", ")})` : ""}`),
    };
  },
});

// ------------------------------------------------------------------ get_context
const get_context = def({
  name: "get_context",
  title: "Assemble relevant context",
  description:
    "Retrieve ranked, token-budgeted code relevant to a natural-language query: matching files, defining symbols, importers/imports and tests, each with the reason it was chosen. Prefer this FIRST for unfamiliar tasks, then read_file for details. Large files are returned as excerpts/outlines; use read_file for the rest.",
  schema: GetContextInput,
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler(input, ctx, signal) {
    const files = input.focusPaths?.length ? input.focusPaths : undefined;
    const bundle = await assembleContext(ctx.ws, { query: input.query, mentions: input.mentions, budgetTokens: Math.min(input.budgetTokens ?? ctx.limits.defaultBudgetTokens, ctx.limits.maxBudgetTokens), focusPaths: files, signal }, ctx.index);
    ctx.emit({ type: "context", query: input.query, bundle });
    return {
      ok: true,
      usedTokens: bundle.usedTokens, budgetTokens: bundle.budgetTokens, terms: bundle.terms, warnings: bundle.warnings,
      items: bundle.items.map((i) => ({ path: i.path, tier: i.tier, range: i.range, tokens: i.tokens, score: i.score, reasons: i.reasons })),
      excluded: bundle.excluded.slice(0, 30),
      rendered: renderBundle(bundle),
    };
  },
});

// ------------------------------------------------------------------ propose_edit
const propose_edit = def({
  name: "propose_edit",
  title: "Propose an edit (does not write)",
  description:
    "Propose a change to ONE file. Nothing is written to disk: proposals are queued for human review. Prefer `edits` with {oldText,newText} (oldText must match exactly once, copied WITHOUT line-number prefixes); {range:{startLine,endLine},newText} replaces whole lines (1-based, inclusive; empty newText deletes). Use newContent (+create:true) for new files, delete:true to remove a file. Pass baseHash from read_file. Always include a short rationale. After all proposals are queued you MUST call submit_changes once — proposals alone are discarded.",
  schema: ProposeEditInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  async handler(input, ctx) {
    const r = await resolveWorkspacePath(ctx.root, input.path, { forWrite: true });
    if (isFailure(r)) return r;
    if (r.rel === ".") return fail("INVALID_INPUT", "path must be a file");
    try {
      const { proposal } = await ctx.review.propose({
        path: r.rel, edits: input.edits, newContent: input.newContent, create: input.create, delete: input.delete,
        rationale: input.rationale, baseHash: input.baseHash, turnId: ctx.turnId?.(),
      });
      ctx.emit({ type: "proposal", proposalId: proposal.id, path: proposal.path });
      const added = proposal.hunks.reduce((n, h) => n + h.added, 0);
      const removed = proposal.hunks.reduce((n, h) => n + h.removed, 0);
      return { ok: true, proposalId: proposal.id, status: "queued", kind: proposal.kind, hunks: proposal.hunks.length, linesAdded: added, linesRemoved: removed, nextContentHash: proposal.proposedText === null ? null : contentHash(proposal.proposedText), note: "queued for review; nothing has been written. NEXT STEP: call submit_changes (your work is discarded otherwise) once all edits are proposed." };
    } catch (e) {
      if (e instanceof ProposeError) return fail(e.code, e.message, e.code === "STALE_BASE" ? "call read_file again and retry with the new contentHash" : undefined);
      throw e;
    }
  },
});

// ------------------------------------------------------------------ submit_changes (the Review Gate)
const submit_changes = def({
  name: "submit_changes",
  title: "Submit proposed changes for human review",
  description:
    "Ask the developer to review the queued proposals. This call is approval-gated: the developer sees every hunk and decides. Call it ONCE after you have proposed all edits (and verified them with run_terminal). Returns which hunks were applied and which were rejected; if some were rejected, revise only if the rejection reason makes the intent clear.",
  schema: SubmitChangesInput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  async handler(input, ctx) {
    if (ctx.review.list().length === 0) return fail("NOT_FOUND", "nothing is queued; call propose_edit first");
    ctx.emit({ type: "review.requested", summary: input.summary });
    if (ctx.reviewMode === "auto-accept") ctx.review.decideAll("accept");
    const rep = await ctx.review.apply({ rejectUndecided: true });
    const decision = rep.applied.length === 0 ? "rejected" : rep.rejected.length + rep.conflicted.length > 0 ? "partially_applied" : "applied";
    ctx.emit({ type: "review.settled", decision });
    if (!rep.ok) return fail("INTERNAL", "applying the accepted changes failed; the workspace was left unchanged");
    const view = ctx.review.view();
    const byId = new Map(view.proposals.map((p) => [p.id, p.path]));
    ctx.review.clearSettled();
    return {
      ok: true, decision, batchId: rep.batchId, filesChanged: rep.filesChanged,
      applied: rep.applied.map((a) => ({ ...a, path: byId.get(a.proposalId) })),
      rejected: rep.rejected.map((a) => ({ ...a, path: byId.get(a.proposalId) })),
      conflicted: rep.conflicted.map((a) => ({ ...a, path: byId.get(a.proposalId) })),
    };
  },
});

// ------------------------------------------------------------------ run_terminal
const run_terminal = def({
  name: "run_terminal",
  title: "Run a command",
  description:
    "Run ONE allowlisted program (pytest, python, node, npm test/run, flask, git status/diff/log, ls, cat, grep, rg, …) without a shell: no pipes, &&, ;, redirects or $(). Leading VAR=value assignments are allowed (e.g. `FLASK_DEBUG=off python -c \"…\"`). Runs in a shadow copy of the workspace that already includes your PROPOSED edits, so you can verify them before submit_changes. Use `cwd` instead of `cd`. Requires developer approval.",
  schema: RunTerminalInput,
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async handler(input, ctx, signal) {
    const decision = evaluateCommand(input.command);
    if (!decision.allowed || !decision.argv) return fail("DENIED", `command not permitted: ${decision.reason}`, "use a single allowlisted program without shell syntax");
    const useShadow = ctx.shadow !== null && !decision.git;
    let baseDir = ctx.root;
    let pyPath: string | undefined;
    if (useShadow && ctx.shadow) {
      await ctx.shadow.sync(signal);
      baseDir = ctx.shadow.dir;
      pyPath = ctx.shadow.pythonPath();
    }
    let cwd = baseDir;
    if (input.cwd) {
      const r = await resolveWorkspacePath(ctx.root, input.cwd, { mustExist: true });
      if (isFailure(r)) return r;
      cwd = r.rel === "." ? baseDir : path.join(baseDir, r.rel);
    }
    const venvBins = [".venv", "venv"].map((d) => path.join(baseDir, d, "bin")).filter((p) => existsSync(p));
    const pathPrefix = [...(ctx.extraPath ?? []), ...venvBins];
    const venvRoot = venvBins[0] ? path.dirname(venvBins[0]) : undefined;
    const env = scrubbedEnv({ ...(pathPrefix.length ? { PATH: [...pathPrefix, process.env.PATH ?? ""].join(path.delimiter), ...(venvRoot ? { VIRTUAL_ENV: venvRoot } : {}) } : {}), ...(pyPath ? { PYTHONPATH: [pyPath, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) } : {}), ...decision.env });
    const res = await runProcess({ argv: decision.argv, cwd, env, timeoutMs: input.timeoutMs ?? 60_000, signal });
    if (res.cancelled) return fail("CANCELLED", "command was cancelled");
    if (res.timedOut) return fail("TIMEOUT", `command exceeded ${input.timeoutMs ?? 60_000} ms and was killed`, "narrow the command (e.g. run a single test file)");
    // keep the TAIL of long output (test summaries and tracebacks are at the end) within the model-sized limit
    const cap = ctx.limits.maxOutputChars;
    const tail = (s: string): string => (s.length > cap ? `…[truncated ${s.length - cap} chars]…\n${s.slice(-cap)}` : s);
    return { ok: true, exitCode: res.exitCode, stdout: tail(res.stdout), stderr: tail(res.stderr), durationMs: res.durationMs, truncated: res.truncated || res.stdout.length > cap || res.stderr.length > cap, ranIn: useShadow ? "shadow" : "workspace" };
  },
});

// ------------------------------------------------------------------ get_diagnostics
const get_diagnostics = def({
  name: "get_diagnostics",
  title: "Editor diagnostics",
  description: "Problems reported by the editor's language servers for files as they are ON DISK (pending proposals are not reflected). Returns an empty list when no language server data is available.",
  schema: GetDiagnosticsInput,
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler(input, ctx) {
    const rels: string[] = [];
    for (const p of input.paths ?? []) {
      const r = await resolveWorkspacePath(ctx.root, p, { mustExist: true });
      if (isFailure(r)) return r;
      rels.push(r.rel);
    }
    if (!ctx.diagnostics) return { ok: true, diagnostics: [], available: false, note: "no language-server diagnostics are available in this environment; run the project's linter/tests with run_terminal" };
    const d = await ctx.diagnostics(rels.length ? rels : undefined, input.severity ?? "all");
    return { ok: true, available: true, diagnostics: d.slice(0, 200), truncated: d.length > 200 };
  },
});

// ------------------------------------------------------------------ get_git_status
function git(args: string[], cwd: string, signal: AbortSignal): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const c = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"], env: scrubbedEnv({ GIT_OPTIONAL_LOCKS: "0" }) });
    let out = "";
    c.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    const onAbort = (): void => void c.kill("SIGKILL");
    signal.addEventListener("abort", onAbort, { once: true });
    c.on("error", () => resolve({ code: null, out: "" }));
    c.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      resolve({ code, out });
    });
  });
}
const get_git_status = def({
  name: "get_git_status",
  title: "Git status",
  description: "Current branch, HEAD, and changed files of the REAL workspace (read-only). Pending proposals are not git changes.",
  schema: GetGitStatusInput,
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler(input, ctx, signal) {
    const st = await git(["status", "--porcelain=v1", "-b"], ctx.root, signal);
    if (st.code !== 0) return fail("NOT_FOUND", "not a git repository (or git is unavailable)");
    const lines = st.out.split("\n").filter(Boolean);
    const branch = (lines.shift() ?? "").replace(/^## /, "").split("...")[0] ?? "";
    const head = (await git(["rev-parse", "--short=8", "HEAD"], ctx.root, signal)).out.trim();
    const changed = lines.map((l) => ({ status: l.slice(0, 2).trim() || "?", path: l.slice(3) }));
    const out: Record<string, unknown> = { ok: true, branch, head, changed, clean: changed.length === 0 };
    if (input.includeDiffStat) out.diffStat = truncate((await git(["diff", "--stat"], ctx.root, signal)).out, 8000).text;
    return out;
  },
});

// ------------------------------------------------------------------ update_plan
const update_plan = def({
  name: "update_plan",
  title: "Publish the task plan",
  description: "Publish or update your step-by-step plan so the developer can follow progress (UI only; no workspace effect). Send the complete list each time with current statuses.",
  schema: UpdatePlanInput,
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler(input, ctx) {
    ctx.emit({ type: "plan", steps: input.steps });
    return { ok: true, steps: input.steps.length };
  },
});

export const TOOLS = [read_file, search_workspace, find_symbol, get_file_structure, get_context, propose_edit, submit_changes, run_terminal, get_diagnostics, get_git_status, update_plan] as const;
export type AnyToolDef = (typeof TOOLS)[number];

export async function callTool(name: string, rawInput: unknown, ctx: ToolContext, signal: AbortSignal): Promise<unknown> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return fail("INVALID_INPUT", `unknown tool ${name}`);
  const parsed = (t.schema as z.ZodType).safeParse(rawInput);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  const started = Date.now();
  let result: unknown;
  try {
    result = await (t.handler as (i: unknown, c: ToolContext, s: AbortSignal) => Promise<unknown>)(parsed.data, ctx, signal);
  } catch (e) {
    if (signal.aborted) result = fail("CANCELLED", "cancelled");
    else result = fail("INTERNAL", `unexpected error: ${(e as Error).message}`);
  }
  const ok = (result as { ok?: boolean }).ok === true;
  ctx.emit({ type: "timeline", event: { id: `${name}-${started}`, at: new Date(started).toISOString(), kind: "tool.result", title: name, detail: ok ? summarize(name, rawInput, result) : (result as ToolFailure).error.message, status: ok ? "ok" : "error", durationMs: Date.now() - started } });
  return result;
}

function summarize(name: string, input: unknown, result: unknown): string {
  const i = input as Record<string, unknown>;
  const r = result as Record<string, unknown>;
  switch (name) {
    case "read_file": return `${i.path as string}`;
    case "search_workspace": return `"${i.query as string}" → ${r.count as number} matches`;
    case "run_terminal": return `${i.command as string} → exit ${r.exitCode as number}`;
    case "propose_edit": return `${i.path as string} (+${r.linesAdded as number}/−${r.linesRemoved as number})`;
    case "get_context": return `${(r.items as unknown[]).length} items, ${r.usedTokens as number}/${r.budgetTokens as number} tokens`;
    default: return "";
  }
}

export { estimateTokens };
