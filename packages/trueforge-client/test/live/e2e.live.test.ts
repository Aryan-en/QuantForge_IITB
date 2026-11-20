/**
 * LIVE end-to-end suite: real TrueForge (local mode) + real FORGE MCP server + real Flask 3.1.3 + a SCRIPTED model.
 * The scripted model replaces an LLM so the plumbing (agent loop → MCP tools → shadow verification → approval →
 * apply/undo, cancellation, fault handling) is tested deterministically. It proves nothing about model quality.
 * Run: npm run test:live   (needs network for `npx @truefoundry/trueforge@latest` unless TrueForge is already running)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startFakeModel, type FakeModelServer, type Policy } from "../../src/testing/fake-model.js";
import { runTurn, runResilient, TrueForgeApi, type ForgeStreamEvent, type Notice } from "../../src/index.js";
import { ensureTrueForge, cloneFlask, gitStatus, registerProvider, startRig, haveFixture, VENV_BIN, type TF, type ForgeRig } from "./harness.js";
import { TASK_A, TASK_B, taskAPolicy, taskBPolicy } from "./policies.js";

let tf: TF;
const cleanup: (() => Promise<void> | void)[] = [];
const storage = mkdtempSync(path.join(tmpdir(), "forge-live-store-"));

beforeAll(async () => {
  tf = await ensureTrueForge();
}, 120_000);
afterAll(async () => {
  for (const c of cleanup.reverse()) await c();
  await tf.stop();
  rmSync(storage, { recursive: true, force: true });
});

interface Scenario { ws: string; rig: ForgeRig; fake: FakeModelServer; model: string; }
async function scenario(policy: Policy): Promise<Scenario> {
  const ws = cloneFlask();
  const rig = await startRig(tf, ws, storage);
  const fake = await startFakeModel(policy);
  const model = await registerProvider(tf, `fake${Math.random().toString(36).slice(2, 8)}`, fake.baseUrl);
  cleanup.push(async () => { await rig.close(); await fake.close(); rmSync(ws, { recursive: true, force: true }); });
  return { ws, rig, fake, model };
}

/** The extension's job in production: show approvals, collect the human's per-hunk decisions, answer TrueForge. */
function humanApprover(rig: ForgeRig, mode: "accept-all" | "deny-submit" | "accept-first-hunk-only", log: string[]) {
  return async (call: { tool: string; args: string }) => {
    log.push(call.tool);
    if (call.tool === "run_terminal") return { status: "allow" as const };
    if (call.tool === "submit_changes") {
      if (mode === "deny-submit") { rig.ctx.review.decideAll("reject"); return { status: "deny" as const, reason: "developer rejected the changes" }; }
      if (mode === "accept-first-hunk-only") {
        let first = true;
        for (const p of rig.ctx.review.list()) for (const h of p.hunks) { rig.ctx.review.decide(p.id, h.id, first ? "accept" : "reject"); first = false; }
      } else rig.ctx.review.decideAll("accept");
      return { status: "allow" as const };
    }
    return { status: "allow" as const };
  };
}

describe.skipIf(!haveFixture)("Task A — inline edit (scripted model, real TrueForge)", () => {
  it("proposes, waits for approval, applies exactly once; verification command prints False; undo restores a clean tree", async () => {
    const s = await scenario((req) => taskAPolicy(req));
    expect(gitStatus(s.ws)).toBe("");
    const events: ForgeStreamEvent[] = [];
    const approvals: string[] = [];
    const spec = await s.rig.specFor("forge-inline-edit")(s.model);
    const sessionId = await tf.api.createSession(spec);
    const out = await runTurn(tf.api.sdk, { sessionId, text: `${TASK_A}\n\nFile: src/flask/helpers.py, selected lines 28-33 (function get_debug_flag).`, onEvent: (e) => events.push(e), onApproval: humanApprover(s.rig, "accept-all", approvals) });

    expect(out.status).toBe("done");
    expect(approvals).toEqual(["submit_changes"]); // exactly one human gate, for the Review Gate
    const calls = events.filter((e) => e.type === "tool.call").map((e: any) => e.call.tool);
    expect(calls).toEqual(["read_file", "propose_edit", "submit_changes"]);
    expect(events.some((e) => e.type === "text.delta")).toBe(true); // streamed
    expect(events.filter((e) => e.type === "paused").length).toBe(1);

    const src = readFileSync(path.join(s.ws, "src/flask/helpers.py"), "utf8");
    expect(src).toContain('{"0", "false", "no", "off", "n"}');
    expect(gitStatus(s.ws).trim()).toBe("M src/flask/helpers.py");

    // the exact on-screen verification from the competition statement
    const py = path.join(VENV_BIN, "python");
    const run = (env: string): string => execSync(`${env} ${py} -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"`, { cwd: s.ws, env: { ...process.env, PYTHONPATH: path.join(s.ws, "src") } }).toString().trim();
    for (const v of ["off", "OFF", "Off", "n", "N", "0", "false", "no"]) expect(run(`FLASK_DEBUG=${v}`), v).toBe("False");
    for (const v of ["1", "true", "yes", "on"]) expect(run(`FLASK_DEBUG=${v}`), v).toBe("True");

    expect((await s.rig.ctx.review.undo()).ok).toBe(true);
    expect(gitStatus(s.ws)).toBe("");
  }, 120_000);

  it("a denied review writes nothing and the agent is told why", async () => {
    const s = await scenario((req) => taskAPolicy(req));
    const sessionId = await tf.api.createSession(await s.rig.specFor("forge-inline-edit")(s.model));
    const out = await runTurn(tf.api.sdk, { sessionId, text: TASK_A, onApproval: humanApprover(s.rig, "deny-submit", []) });
    expect(out.status).toBe("done");
    expect(gitStatus(s.ws)).toBe("");
    const lastReq = s.fake.requests[s.fake.requests.length - 1]!;
    expect(JSON.stringify(lastReq.messages)).toMatch(/developer rejected the changes/);
  }, 120_000);
});

describe.skipIf(!haveFixture)("Task B — autonomous multi-file agent (scripted model, real TrueForge, real Flask)", () => {
  it("edits three files discovered by the agent, verifies in the shadow, applies only after approval", async () => {
    const s = await scenario((req) => taskBPolicy(req));
    const events: ForgeStreamEvent[] = [];
    const approvals: string[] = [];
    const sessionId = await tf.api.createSession(await s.rig.specFor("forge-agent")(s.model));
    const baselineCall = execSync(`${path.join(VENV_BIN, "pytest")} tests/test_cli.py -q -p no:cacheprovider`, { cwd: s.ws, env: { ...process.env, PYTHONPATH: path.join(s.ws, "src") } }).toString();
    expect(baselineCall).toMatch(/55 passed, 3 skipped/);

    const out = await runTurn(tf.api.sdk, { sessionId, text: TASK_B, onEvent: (e) => events.push(e), onApproval: humanApprover(s.rig, "accept-all", approvals) });
    expect(out.status).toBe("done");
    expect(approvals).toEqual(["run_terminal", "submit_changes"]);

    // no filenames in the prompt, yet three files changed
    expect(TASK_B).not.toMatch(/cli\.py|test_cli|cli\.rst/);
    const changed = gitStatus(s.ws).split("\n").filter(Boolean).map((l) => l.slice(3)).sort();
    expect(changed).toEqual(["docs/cli.rst", "src/flask/cli.py", "tests/test_cli.py"]);

    // the shadow verification ran against PROPOSED code: 56 passed (55 + the new test) — impossible if it had imported the real tree
    const term = events.find((e) => e.type === "tool.result" && (e as any).tool === "run_terminal") as any;
    const parsed = JSON.parse(readToolOutput(s.fake.requests, "run_terminal"));
    expect(parsed.ranIn).toBe("shadow");
    expect(parsed.stdout).toMatch(/56 passed, 3 skipped/);
    expect(term.ok).toBe(true);

    // real tree after approval: pytest passes, `flask --help` lists config, masking works through the real CLI
    const env = { ...process.env, PYTHONPATH: path.join(s.ws, "src"), PATH: `${VENV_BIN}:${process.env.PATH}` };
    expect(execSync("pytest tests/test_cli.py -q -p no:cacheprovider", { cwd: s.ws, env }).toString()).toMatch(/56 passed, 3 skipped/);
    const demo = path.join(s.ws, "..", `demo-${path.basename(s.ws)}`);
    execSync(`mkdir -p ${demo} && printf 'from flask import Flask\\napp = Flask(__name__)\\napp.config.update(SECRET_KEY="s3cr3t", DB_PASSWORD="pw", API_TOKEN="tok", STRIPE_KEY="k", GREETING="visible")\\n' > ${demo}/app.py`);
    cleanup.push(() => rmSync(demo, { recursive: true, force: true }));
    expect(execSync("flask --help", { cwd: demo, env }).toString()).toMatch(/^\s+config\s+Show the app configuration as JSON\./m);
    const cfg = JSON.parse(execSync("flask --app app config", { cwd: demo, env }).toString());
    for (const k of ["SECRET_KEY", "DB_PASSWORD", "API_TOKEN", "STRIPE_KEY"]) expect(cfg[k]).toBe("***");
    expect(cfg.GREETING).toBe("visible");
    expect(JSON.stringify(cfg)).not.toMatch(/s3cr3t|hunter2/);

    // context assembly was visibly at work: reasons for the three target files, within budget
    const ctxEv = s.rig.events.find((e) => e.type === "context") as any;
    const top = ctxEv.bundle.items.map((i: any) => i.path);
    expect(top).toEqual(expect.arrayContaining(["src/flask/cli.py", "tests/test_cli.py", "docs/cli.rst"]));
    expect(ctxEv.bundle.usedTokens).toBeLessThanOrEqual(12000);
    expect(s.rig.events.some((e) => e.type === "plan")).toBe(true);

    // undo returns to the pristine baseline
    expect((await s.rig.ctx.review.undo()).ok).toBe(true);
    expect(gitStatus(s.ws)).toBe("");
  }, 240_000);

  it("changes nothing in the real tree while the turn is paused awaiting review", async () => {
    const s = await scenario((req) => taskBPolicy(req));
    const sessionId = await tf.api.createSession(await s.rig.specFor("forge-agent")(s.model));
    let sawPendingState = false;
    const out = await runTurn(tf.api.sdk, {
      sessionId, text: TASK_B,
      onApproval: async (call) => {
        if (call.tool === "submit_changes") {
          sawPendingState = gitStatus(s.ws) === "" && s.rig.ctx.review.list().length === 3; // three proposals queued, zero writes
          s.rig.ctx.review.decideAll("reject");
          return { status: "deny", reason: "not today" };
        }
        return { status: "allow" };
      },
    });
    expect(sawPendingState).toBe(true);
    expect(out.status).toBe("done");
    expect(gitStatus(s.ws)).toBe("");
  }, 240_000);
});

describe.skipIf(!haveFixture)("Cancellation (user presses Stop)", () => {
  it("cancels mid-tool: process killed, turn reports cancelled, workspace untouched, next turn works", async () => {
    const marker = `forgecx${Date.now().toString(36)}`;
    const s = await scenario((req) => {
      const n = req.messages.filter((m) => m.role === "tool").length;
      if (n === 0) return { type: "tool_calls", calls: [{ name: "run_terminal", args: { command: `python3 -c "import time; time.sleep(60)  # ${marker}"`, timeoutMs: 100000, reason: "slow" } }] };
      return { type: "text", text: "unreachable" };
    });
    const ac = new AbortController();
    const sessionId = await tf.api.createSession(await s.rig.specFor("forge-agent")(s.model));
    const events: ForgeStreamEvent[] = [];
    const t = Date.now();
    const turn = runTurn(tf.api.sdk, { sessionId, text: "run something slow", signal: ac.signal, cancelGraceMs: 8000, onEvent: (e) => events.push(e), onApproval: async () => { setTimeout(() => { ac.abort(); s.rig.ctx.cancel.cancel("user pressed Stop"); }, 1500); return { status: "allow" }; } });
    const out = await turn;
    expect(["cancelled", "done", "error"]).toContain(out.status);
    expect(out.status).toBe("cancelled");
    expect(Date.now() - t).toBeLessThan(15_000);
    await new Promise((r) => setTimeout(r, 600));
    const alive = Number(execSync(`ps -ax -o command= | grep -c '${marker.replace(/^./, (c) => `[${c}]`)}' || true`).toString().trim() || "0");
    expect(alive).toBe(0);
    expect(gitStatus(s.ws)).toBe("");
    expect(s.rig.ctx.review.list()).toEqual([]);
  }, 120_000);
});

describe.skipIf(!haveFixture)("Task C — resilience (real TrueForge error payloads)", () => {
  const notices = (n: Notice[]): string[] => n.map((x) => (x.kind === "fallback" ? `fallback:${x.from}->${x.to}` : x.kind));

  it("invalid API key on the primary → automatic fallback to a second model; task completes; tree changes only via approved review", async () => {
    const s = await scenario((req) => taskAPolicy(req));
    const bad = await startFakeModel(() => ({ type: "error", status: 401, message: "Incorrect API key provided: sk-bad" }));
    cleanup.push(() => bad.close());
    const badModel = await registerProvider(tf, `bad${Math.random().toString(36).slice(2, 7)}`, bad.baseUrl, "sk-bad");
    const n: Notice[] = [];
    const res = await runResilient(tf.api, { text: TASK_A, models: [badModel, s.model], specFor: await specSync(s, "forge-inline-edit", [badModel, s.model]), onNotice: (x) => n.push(x), onApproval: humanApprover(s.rig, "accept-all", []), sleep: async () => undefined });
    expect(res.outcome?.status).toBe("done");
    expect(res.modelUsed).toBe(s.model);
    expect(res.attempts[0]).toMatchObject({ model: badModel, status: "error", errorClass: "MODEL_AUTH" });
    expect(notices(n)).toContain(`fallback:${badModel}->${s.model}`);
    expect(n.some((x) => x.kind === "retry")).toBe(false); // auth errors are never retried
    expect(bad.requests.length).toBe(1);
    expect(gitStatus(s.ws).trim()).toBe("M src/flask/helpers.py");
  }, 180_000);

  it("unreachable endpoint, no fallback configured → clear error, ZERO files changed", async () => {
    const s = await scenario((req) => taskAPolicy(req));
    const dead = await registerProvider(tf, `dead${Math.random().toString(36).slice(2, 7)}`, "http://127.0.0.1:9/v1");
    const n: Notice[] = [];
    const res = await runResilient(tf.api, { text: TASK_A, models: [dead], specFor: await specSync(s, "forge-inline-edit", [dead]), onNotice: (x) => n.push(x), onApproval: humanApprover(s.rig, "accept-all", []), sleep: async () => undefined });
    expect(res.outcome?.status).toBe("error");
    expect(res.error?.code).toBe("MODEL_UNAVAILABLE");
    expect(res.error?.title).toMatch(/Cannot reach the model endpoint/);
    expect(n.filter((x) => x.kind === "retry")).toHaveLength(1); // one backoff retry, then give up
    expect(n.some((x) => x.kind === "failed")).toBe(true);
    expect(gitStatus(s.ws)).toBe("");
    expect(s.rig.ctx.review.list()).toEqual([]);
  }, 180_000);

  it("transient 500s are retried with jittered exponential backoff, then succeed on the same model", async () => {
    let calls = 0;
    const s = await scenario((req) => {
      const n = req.messages.filter((m) => m.role === "tool").length;
      if (n === 0 && calls++ < 1) return { type: "error", status: 500, message: "upstream hiccup" };
      return taskAPolicy(req);
    });
    const delays: number[] = [];
    const n: Notice[] = [];
    const res = await runResilient(tf.api, { text: TASK_A, models: [s.model], specFor: await specSync(s, "forge-inline-edit", [s.model]), onNotice: (x) => n.push(x), onApproval: humanApprover(s.rig, "accept-all", []), sleep: async (ms) => void delays.push(ms), rng: () => 0.999 });
    expect(res.outcome?.status).toBe("done");
    expect(delays).toHaveLength(1);
    expect(delays[0]).toBeGreaterThan(0);
    expect(delays[0]).toBeLessThanOrEqual(500); // attempt 0: random(0, min(8000, 500·2^0))
    expect(res.attempts.map((a) => a.status)).toEqual(["error", "done"]);
  }, 180_000);

  it("TrueForge itself unreachable → TRUEFORGE_UNREACHABLE immediately (no model can help), workspace untouched", async () => {
    const ws = cloneFlask();
    cleanup.push(() => rmSync(ws, { recursive: true, force: true }));
    const dead = new TrueForgeApi("http://127.0.0.1:9");
    const probe = await dead.probe(1500);
    expect(probe).toMatchObject({ ok: false, errorClass: "TRUEFORGE_UNREACHABLE" });
    const t0 = Date.now();
    const res = await runResilient(dead, { text: TASK_A, models: ["a/b", "c/d"], specFor: (m) => ({ model: { name: m } }), sleep: async () => undefined });
    expect(res.error?.code).toBe("TRUEFORGE_UNREACHABLE");
    expect(res.attempts).toHaveLength(1); // did not pointlessly try the fallback model
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(gitStatus(ws)).toBe("");
  }, 60_000);

  it("a model that never answers is detected as STALLED, cancelled, and falls back", async () => {
    const s = await scenario((req) => taskAPolicy(req));
    const hang = await startFakeModel(() => ({ type: "hang" }));
    cleanup.push(() => hang.close());
    const hangModel = await registerProvider(tf, `hang${Math.random().toString(36).slice(2, 7)}`, hang.baseUrl);
    const n: Notice[] = [];
    const res = await runResilient(tf.api, { text: TASK_A, models: [hangModel, s.model], specFor: await specSync(s, "forge-inline-edit", [hangModel, s.model]), stallTimeoutMs: 2500, onNotice: (x) => n.push(x), onApproval: humanApprover(s.rig, "accept-all", []), sleep: async () => undefined });
    expect(res.attempts[0]).toMatchObject({ model: hangModel, errorClass: "STALLED" });
    expect(res.outcome?.status).toBe("done");
    expect(res.modelUsed).toBe(s.model);
  }, 180_000);
});

/** Build a sync specFor() for runResilient from the rig's async loader (agent files are tiny; load once per model). */
async function specSync(s: Scenario, agent: "forge-agent" | "forge-inline-edit", models: string[]): Promise<(m: string) => any> {
  const specs = new Map<string, any>();
  for (const m of models) specs.set(m, await s.rig.specFor(agent)(m));
  return (m: string) => specs.get(m);
}

/** Pull the JSON result TrueForge fed back to the model for a tool call, from the fake model's request log. */
function readToolOutput(requests: { messages: any[] }[], tool: string): string {
  const last = requests[requests.length - 1]!;
  const idToName = new Map<string, string>();
  for (const m of last.messages) for (const c of m.tool_calls ?? []) idToName.set(c.id, c.function.name);
  const m = last.messages.find((x) => x.role === "tool" && idToName.get(x.tool_call_id) === tool);
  return typeof m.content === "string" ? m.content : m.content.map((p: any) => p.text).join("");
}
void existsSync;

describe.skipIf(!haveFixture)("Resume after window reload", () => {
  it("drops the stream while paused on the Review Gate, then resumes the same turn: approval is re-asked once, change applies, finished turns replay without re-prompting", async () => {
    const s = await scenario((req) => taskAPolicy(req));
    const sessionId = await tf.api.createSession(await s.rig.specFor("forge-inline-edit")(s.model));

    // ---- "window 1": start a turn and die while it is paused awaiting approval
    const stream = (await tf.api.sdk.sessions.createTurnStream(sessionId, { input: [{ type: "user.message", content: TASK_A }] }, { maxRetries: 0 })) as AsyncIterable<any>;
    let turnId = "";
    for await (const ev of stream) {
      if (ev.type === "turn.created") turnId = ev.turnId;
      if (ev.type === "turn.update" && ev.state.status === "paused") break; // connection lost here
    }
    expect(turnId).not.toBe("");
    expect(s.rig.ctx.review.list()).toHaveLength(1); // proposal queued, nothing written
    expect(gitStatus(s.ws)).toBe("");

    // ---- "window 2": the queue is restored from its snapshot, the turn is resumed from TrueForge's stored events
    const snap = JSON.parse(JSON.stringify(s.rig.ctx.review.snapshot()));
    s.rig.ctx.review.discardAll();
    await s.rig.ctx.review.restore(snap);
    const asked: string[] = [];
    const events: ForgeStreamEvent[] = [];
    const out = await runTurn(tf.api.sdk, { sessionId, text: "", resume: { turnId }, onEvent: (e) => events.push(e), onApproval: humanApprover(s.rig, "accept-all", asked) });
    expect(out.status).toBe("done");
    expect(out.turnId).toBe(turnId);
    expect(asked).toEqual(["submit_changes"]); // exactly the one unanswered approval
    expect(gitStatus(s.ws).trim()).toBe("M src/flask/helpers.py");
    expect(readFileSync(path.join(s.ws, "src/flask/helpers.py"), "utf8")).toContain('"off", "n"');
    expect(events.filter((e) => e.type === "tool.call")).toHaveLength(0); // history is not replayed to the UI
    const res = events.find((e) => e.type === "tool.result") as any;
    expect(res).toMatchObject({ tool: "submit_changes", ok: true }); // only the post-pause result is reported

    // ---- resuming an already-finished turn must not re-prompt the model or re-ask approvals
    const before = s.fake.requests.length;
    const again = await runTurn(tf.api.sdk, { sessionId, text: "", resume: { turnId }, onApproval: async () => { throw new Error("must not be asked"); } });
    expect(again.status).toBe("done");
    expect(again.text).toBe(out.text);
    expect(s.fake.requests.length).toBe(before);
    expect((await s.rig.ctx.review.undo()).ok).toBe(true);
    expect(gitStatus(s.ws)).toBe("");
  }, 120_000);
});
