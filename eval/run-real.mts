/* Runs the fixed Flask tasks with a REAL model configured in TrueForge and verifies the outcome with real commands.
 * The human reviewer is simulated by accepting every hunk (the statement's "review the hunks and accept").
 * Usage: npx tsx eval/run-real.mts --model <provider/model> [--fallback-from <provider/model>] [--task A|B|C|all]
 *        [--tf http://localhost:8790] [--timeout-min 12] [--params '{"reasoning_effort":"none"}']
 * Results are appended to eval/results/<timestamp>-<model>.json — pass AND fail. */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runResilient, TrueForgeApi, loadAgent, type ForgeStreamEvent, type Notice } from "../packages/trueforge-client/src/index.js";
import { createToolContext, limitsForContext, startForgeMcpHttp } from "../packages/editor-mcp/src/index.js";
import { cloneFlask, gitStatus, VENV_BIN, AGENTS } from "../packages/trueforge-client/test/live/harness.js";
import { TASK_A, TASK_B } from "../packages/trueforge-client/test/live/policies.js";

const arg = (n: string, d?: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const tfUrl = arg("tf", "http://localhost:8790")!;
const model = arg("model");
if (!model) { console.error("--model <provider/model> required"); process.exit(2); }
const failFirst = arg("fallback-from");
const which = (arg("task", "all")!).toUpperCase();
const timeoutMs = Number(arg("timeout-min", "12")) * 60_000;
/** Local models can take minutes to the first token on long prompts; the extension default (45 s) is for hosted models. */
const stallMs = Number(arg("stall-sec", "600")) * 1000;
const params = arg("params") ? (JSON.parse(arg("params")!) as Record<string, unknown>) : {};

const api = new TrueForgeApi(tfUrl);
const probe = await api.probe();
if (!probe.ok) { console.error(`TrueForge not reachable: ${probe.message}`); process.exit(2); }

interface Result { diff?: string; proposed?: unknown; usedSafetyNet?: boolean; task: string; model: string; modelsTried: string[]; status: string; passed: boolean; checks: { name: string; pass: boolean; detail?: string }[]; toolTrace: string[]; subagents: number; durationS: number; tokens: number | null; finalText: string; notices: string[]; error?: string }
const results: Result[] = [];

async function runTask(task: "A" | "B" | "C"): Promise<Result> {
  const ws = cloneFlask();
  const storage = mkdtempSync(path.join(tmpdir(), "forge-real-"));
  const modelInfo = await api.listModels();
  const ctxLens = [model!, ...(failFirst ? [failFirst] : [])].map((m) => modelInfo.find((i) => i.name === m)?.contextLength).filter((n): n is number => !!n);
  const ctx = await createToolContext({ root: ws, storageDir: storage, reviewMode: "host", extraPath: [VENV_BIN], modelContextTokens: ctxLens.length ? Math.min(...ctxLens) : undefined });
  console.log(`   tool limits: ${JSON.stringify(ctx.limits)}`);
  const srv = await startForgeMcpHttp(ctx);
  await api.upsertMcpServer({ name: "forge-editor", url: srv.url, token: srv.token });
  const events: ForgeStreamEvent[] = [];
  const notices: string[] = [];
  const checks: Result["checks"] = [];
  const check = (name: string, pass: boolean, detail?: string): void => { checks.push({ name, pass, ...(detail ? { detail } : {}) }); console.log(`   ${pass ? "PASS" : "FAIL"}  ${name}${detail && !pass ? ` — ${detail.slice(0, 200)}` : ""}`); };
  const agentName = task === "B" ? "forge-agent" : "forge-inline-edit";
  const models = task === "C" ? [failFirst ?? "ollama-dead/mdl", model!] : [model!];
  const specs = new Map<string, any>();
  for (const m of models) { const s = (await loadAgent(AGENTS, agentName, { model: m })).spec; s.model = { ...s.model, params: { ...(s.model.params ?? {}), ...params } }; specs.set(m, s); }
  const text = task === "B" ? TASK_B : `File: src/flask/helpers.py\nSelected lines: 28-33 (function get_debug_flag)\n\n(Address EVERY clause of the instruction: if it asks for a behaviour change and for documentation/docstring changes, your edit must contain both.)\nInstruction: ${TASK_A}`;
  const approvals: string[] = [];
  const t0 = Date.now();
  const ac = new AbortController();
  const killer = setTimeout(() => { ac.abort(); ctx.cancel.cancel("timeout"); }, timeoutMs);
  console.log(`\n=== Task ${task} · model ${models.join(" → ")} · workspace ${ws}`);
  let tokens: number | null = null, status = "error", finalText = "", error: string | undefined;
  try {
    const res = await runResilient(api, {
      text, models, specFor: (m) => specs.get(m), signal: ac.signal, stallTimeoutMs: stallMs,
      onEvent: (e) => { events.push(e); if (e.type === "tool.call") process.stdout.write(`   · ${e.call.tool}\n`); if (e.type === "subagent.start") process.stdout.write(`   ↳ subagent: ${e.title}\n`); },
      onNotice: (n: Notice) => { const s = n.kind === "fallback" ? `fallback ${n.from} -> ${n.to}: ${n.reason}` : n.kind === "retry" ? `retry ${n.attempt} (${n.reason})` : n.kind === "failed" ? `failed: ${n.error.title}` : ""; if (s) { notices.push(s); console.log(`   ! ${s}`); } },
      onApproval: async (call) => {
        if (call.tool === "submit_changes") { const g = ctx.review.submitGate(); if (!g.pass) { notices.push("submit_changes declined by completeness gate"); console.log("   ! submit_changes declined: verify_changes first"); return { status: "deny", reason: g.reason }; } ctx.review.decideAll("accept"); }
        approvals.push(call.tool); return { status: "allow" };
      },
    });
    status = res.outcome?.status ?? (res.error ? "error" : "unknown");
    finalText = res.outcome?.text ?? res.error?.message ?? "";
    tokens = res.outcome?.totalTokens ?? null;
    if (res.error) error = `${res.error.code}: ${res.error.title}`;
    check("turn completed", status === "done", `${status} ${error ?? ""}`);
  } catch (e) { error = String(e); check("turn completed", false, error); }
  clearTimeout(killer);
  // What the model actually proposed (kept in the results even if it never submitted).
  const proposed = ctx.review.list().map((p) => ({ path: p.path, kind: p.kind, rationale: p.rationale, added: p.hunks.reduce((n, h) => n + h.added, 0), removed: p.hunks.reduce((n, h) => n + h.removed, 0) }));
  // Same safety net as the extension: a model that ends its turn without submit_changes still gets its proposals put in front of the (simulated) reviewer.
  let usedSafetyNet = false;
  if (ctx.review.list().length > 0 && !approvals.includes("submit_changes")) {
    usedSafetyNet = true;
    ctx.review.decideAll("accept");
    await ctx.review.apply({ rejectUndecided: true });
    console.log(`   ! model ended without submit_changes; safety-net review applied ${proposed.length} proposal(s)`);
  }
  const py = path.join(VENV_BIN, "python");
  const env = { ...process.env, PYTHONPATH: path.join(ws, "src"), PATH: `${VENV_BIN}:${process.env.PATH}` };
  const sh = (cmd: string, cwd = ws): string => { try { return execSync(cmd, { cwd, env, stdio: ["ignore", "pipe", "pipe"] }).toString(); } catch (e: any) { return `EXIT ${e.status}: ${(e.stdout ?? "") + (e.stderr ?? "")}`; } };
  const changed = gitStatus(ws).split("\n").filter(Boolean).map((l) => l.slice(3)).sort();

  if (task === "A" || (task === "C" && status === "done")) {
    const ev = (v: string): string => sh(`FLASK_DEBUG=${v} ${py} -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"`).trim();
    const off = ev("off");
    check("FLASK_DEBUG=off → False (statement's verification)", off === "False", off);
    check("'n', 'N', 'OFF' → False", ["n", "N", "OFF"].every((v) => ev(v) === "False"));
    check("existing behaviour kept: 0/false/no → False, 1/true → True", ["0", "false", "no"].every((v) => ev(v) === "False") && ["1", "true"].every((v) => ev(v) === "True"));
    const src = readFileSync(path.join(ws, "src/flask/helpers.py"), "utf8");
    const doc = /def get_debug_flag[\s\S]*?"""([\s\S]*?)"""/.exec(src)?.[1] ?? "";
    check("docstring lists every false value (0, false, no, off, n)", ["0", "false", "no", "off", "n"].every((v) => new RegExp(`(^|[^a-z])${v}([^a-z]|$)`, "i").test(doc)), doc.replace(/\s+/g, " ").slice(0, 160));
    check("only src/flask/helpers.py changed", changed.length === 1 && changed[0] === "src/flask/helpers.py", changed.join(","));
  }
  if (task === "B") {
    check("prompt names no files", !/cli\.py|test_cli|cli\.rst/.test(TASK_B));
    check("≥3 files changed (statement requires ≥3)", changed.length >= 3, changed.join(", "));
    check("touches the CLI module, a test and docs", changed.some((f) => f === "src/flask/cli.py") && changed.some((f) => /^tests\//.test(f)) && changed.some((f) => /^docs\//.test(f)), changed.join(", "));
    const pt = sh(`${path.join(VENV_BIN, "pytest")} tests/test_cli.py -q -p no:cacheprovider 2>&1 | tail -1`).trim();
    check("pytest tests/test_cli.py -q passes (statement's verification)", /\d+ passed/.test(pt) && !/failed|error/i.test(pt), pt);
    const demo = mkdtempSync(path.join(tmpdir(), "forge-demo-"));
    writeFileSync(path.join(demo, "app.py"), 'from flask import Flask\napp = Flask(__name__)\napp.config.update(SECRET_KEY="s3cr3t", DB_PASSWORD="pw", API_TOKEN="tok", STRIPE_KEY="k", GREETING="visible")\n');
    check("`flask --help` lists config", /^\s+config\b/m.test(sh("flask --app app --help", demo)));
    let cfg: any = null; try { cfg = JSON.parse(sh("flask --app app config", demo)); } catch { /* not JSON */ }
    check("`flask config` prints JSON", cfg !== null);
    check("sensitive values masked as \"***\", others visible", !!cfg && ["SECRET_KEY", "DB_PASSWORD", "API_TOKEN", "STRIPE_KEY"].every((k) => cfg[k] === "***") && cfg.GREETING === "visible");
    rmSync(demo, { recursive: true, force: true });
  }
  if (task === "C") {
    check("workspace never silently changed (only an approved change, or nothing)", changed.length === 0 || (status === "done" && changed.length === 1 && changed[0] === "src/flask/helpers.py"), changed.join(","));
    check("failure was visible (notice) — fallback or clear error", notices.length > 0, notices.join(" | "));
    if (status !== "done") check("clear error and zero files changed", changed.length === 0 && !!error, `${error} / ${changed.join(",")}`);
  }
  const diff = sh("git diff --no-color").slice(0, 3500);
  const trace = events.filter((e) => e.type === "tool.call").map((e: any) => e.call.tool);
  const r: Result = { diff, proposed, usedSafetyNet, task, model: models.join(" → "), modelsTried: models, status, passed: checks.every((c) => c.pass), checks, toolTrace: trace, subagents: events.filter((e) => e.type === "subagent.start").length, durationS: Math.round((Date.now() - t0) / 1000), tokens, finalText: finalText.slice(0, 600), notices, ...(error ? { error } : {}) };
  if (!r.passed && diff) console.log("   --- what the model changed ---\n" + diff.split("\n").map((l) => "   " + l).join("\n"));
  console.log(`   → ${r.passed ? "PASSED" : "FAILED"} in ${r.durationS}s · ${trace.length} tool calls · tokens ${tokens ?? "n/a"} · subagents ${r.subagents}`);
  await srv.close();
  rmSync(ws, { recursive: true, force: true });
  return r;
}

for (const t of (which === "ALL" ? ["A", "B", "C"] : [which]) as ("A" | "B" | "C")[]) results.push(await runTask(t));
mkdirSync(path.resolve(import.meta.dirname ?? ".", "results"), { recursive: true });
const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), "results", `${new Date().toISOString().replace(/[:.]/g, "-")}-${model.replace(/\W+/g, "_")}.json`);
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), tf: tfUrl, model, params, results }, null, 1));
console.log(`\nSUMMARY ${results.map((r) => `${r.task}:${r.passed ? "PASS" : "FAIL"}`).join("  ")}  → ${path.relative(process.cwd(), out)}`);
process.exit(0);
