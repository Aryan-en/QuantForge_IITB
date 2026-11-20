/**
 * Mock host for the Next.js harness. Replays scripted TrueForge-shaped events so the UI can be built
 * and rehearsed without VS Code. It is NOT the product: the demo video must use the real extension.
 * Scenario event shapes are the contract the extension's EventNormalizer must also emit.
 */
import {
  messageId,
  type AppState,
  type ContextState,
  type ErrorCode,
  type HostToWebview,
  type ModelState,
  type ReviewQueueState,
  type TimelineEvent,
  type ToolCall,
  type ToolName,
  type TurnPhase,
  type WebviewToHost,
} from "@/lib/protocol";
import { DEFAULT_APP_STATE } from "@/lib/store/reducer";
import { TASK_B_CONTEXT, taskAFiles, taskBFiles, taskBPlan } from "@/lib/scenarios/fixtures";
import type { Host } from "./types";

export type ScenarioId = "auto" | "A" | "B" | "C-error" | "C-fallback";

export interface MockHost extends Host {
  kind: "mock";
  setScenario(id: ScenarioId): void;
  setSpeed(multiplier: number): void;
  /** Re-send a fresh connected snapshot and clear everything (used by the harness "Reset"). */
  reset(): void;
}

type Listener = (m: HostToWebview) => void;
const PRIMARY = "anthropic/claude-sonnet";
const FALLBACK = "openai-compatible/qwen2.5-coder-7b (local)";

class Aborted extends Error {}

export function createMockHost(): MockHost {
  const listeners = new Set<Listener>();
  let scenario: ScenarioId = "auto";
  let speed = 1;
  let run = 0; // incremented to abort the active script
  let review: ReviewQueueState = { batchId: null, files: [] };
  let decisions = new Map<string, (d: "allow" | "deny") => void>();
  let applyWaiter: (() => void) | null = null;
  let model: ModelState = { primary: PRIMARY, fallbacks: [FALLBACK], active: PRIMARY, status: "connected" };
  let uid = 0;
  const nid = (p: string) => `${p}${++uid}`;

  const emit = <T extends HostToWebview["type"]>(type: T, payload: Extract<HostToWebview, { type: T }>["payload"]) => {
    const msg = { v: 1, id: messageId("h"), type, payload } as HostToWebview;
    listeners.forEach((l) => l(msg));
  };

  const snapshot = (over?: Partial<AppState>) => {
    const state: AppState = {
      ...DEFAULT_APP_STATE,
      connection: { status: "connected", baseUrl: "http://localhost:8790" },
      model,
      sessions: [{ id: "ses_01HZX9", title: "flask config command", createdAt: Date.now() - 3_600_000, turns: 2, agent: "forge-agent", trueforgeUrl: "http://localhost:8790/sessions/ses_01HZX9" }],
      activeSessionId: "ses_01HZX9",
      ...over,
    };
    emit("state.snapshot", { state });
  };

  const sleep = (ms: number, token: number) =>
    new Promise<void>((resolve, reject) => {
      setTimeout(() => (token === run ? resolve() : reject(new Aborted())), ms / speed);
    });

  const checkpoint = (token: number) => {
    if (token !== run) throw new Aborted();
  };

  // ----- small building blocks -----
  const t0 = { v: 0 };
  let curTurn = "turn_0";
  const tl = (e: Omit<TimelineEvent, "id" | "at"> & { id?: string }) => emit("timeline.event", { event: { id: e.id ?? nid("tl"), at: Date.now(), ...e } });

  const status = (turnId: string, s: "running" | "paused" | "done" | "cancelled" | "error", phase?: TurnPhase, detail?: string) =>
    emit("turn.status", { turn: { id: turnId, status: s, phase, phaseDetail: detail, startedAt: t0.v, model: model.active ?? undefined, tokens: { input: 1800 + uid * 90, output: 220 + uid * 31 } } });

  async function stream(turnId: string, token: number, text: string, threadId = "main") {
    const id = nid("asst");
    emit("conversation.append", { item: { kind: "assistant", id, threadId, text: "", streaming: true, at: Date.now() } });
    const words = text.split(/(?<=\s)/);
    for (let i = 0; i < words.length; i += 2) {
      await sleep(28, token);
      emit("stream.delta", { turnId, threadId, itemId: id, text: words.slice(i, i + 2).join("") });
    }
    emit("stream.end", { itemId: id });
  }

  async function tool(token: number, tool: ToolName, summary: string, opts: { args?: Record<string, unknown>; result?: string; ms?: number; threadId?: string; fail?: string } = {}) {
    const callId = nid("call");
    const base: ToolCall = { callId, tool, summary, args: opts.args, status: "running", startedAt: Date.now(), threadId: opts.threadId };
    if (!opts.threadId) emit("conversation.append", { item: { kind: "tool", id: nid("it"), callId } });
    else emit("conversation.append", { item: { kind: "tool", id: nid("it"), callId } });
    emit("tool.updated", { call: base });
    const ms = opts.ms ?? 420;
    await sleep(ms, token);
    emit("tool.updated", { call: { ...base, status: opts.fail ? "failed" : "succeeded", durationMs: ms, resultSummary: opts.result, error: opts.fail } });
    tl({ kind: "tool.call", title: `${tool} ${summary}`, detail: opts.result, durationMs: ms, status: opts.fail ? "error" : "success" });
    return callId;
  }

  async function begin(token: number, text: string, turnId: string) {
    t0.v = Date.now();
    curTurn = turnId;
    emit("conversation.append", { item: { kind: "user", id: nid("u"), text, mentions: [], at: Date.now() } });
    tl({ kind: "user.message", title: "User message", detail: text.slice(0, 80), status: "info" });
    status(turnId, "running", "thinking");
    tl({ kind: "model.call", title: `Model call · ${model.active}`, status: "running" });
    await sleep(500, token);
  }

  // ----- scenario A: inline edit -----
  async function scenarioA(token: number, text: string) {
    const turnId = nid("turn");
    emit("timeline.event", { event: { id: nid("tl"), at: Date.now(), kind: "session.start", title: "Session started · forge-inline-edit", detail: "ses_01HZX9", status: "info" } });
    await begin(token, text, turnId);
    status(turnId, "running", "reading", "src/flask/helpers.py:27-33");
    await tool(token, "get_file_structure", "src/flask/helpers.py", { result: "12 symbols, 14 imports", ms: 260 });
    await tool(token, "read_file", "src/flask/helpers.py:20-40", { args: { path: "src/flask/helpers.py", range: { startLine: 20, endLine: 40 } }, result: "21 lines · hash 9f3c1a", ms: 220 });
    status(turnId, "running", "editing");
    await stream(turnId, token, "`get_debug_flag` lowercases the value, so adding `off` and `n` to the falsy set makes the check case-insensitive. I'll also list every false value in the docstring.", "main");
    await tool(token, "propose_edit", "src/flask/helpers.py (2 hunks)", { result: "queued · 2 hunks · +4 −2", ms: 300 });
    review = { batchId: "batch_a", files: taskAFiles(), origin: "inline_edit", summary: "get_debug_flag: also treat 'off' and 'n' as false; docstring lists all falsy values." };
    emit("review.updated", { queue: review });
    status(turnId, "done");
    tl({ kind: "turn.done", title: "Turn done", detail: "1 file proposed · nothing written yet", status: "success" });
  }

  // ----- scenario B: agent mode -----
  async function scenarioB(token: number, text: string) {
    const turnId = nid("turn");
    emit("timeline.event", { event: { id: nid("tl"), at: Date.now(), kind: "session.start", title: "Session started · forge-agent", detail: "ses_01HZX9 · deferred tool loading on", status: "info" } });
    await begin(token, text, turnId);
    tl({ kind: "tool.deferred_load", title: "Deferred tool load: get_context, find_symbol", detail: "schemas loaded on demand (preload: false)", status: "info" });
    await stream(turnId, token, "I don't know which files own CLI commands yet, so I'll delegate discovery to a subagent and keep my own context small.", "main");

    // subagent discovery (context-engineering feature, visible in session)
    const threadId = "thr_discovery";
    const sa = { threadId, title: "Find files for CLI commands, tests and docs", status: "running" as const, steps: [], startedAt: Date.now() };
    emit("conversation.append", { item: { kind: "subagent", id: nid("it"), threadId } });
    emit("subagent.updated", { subagent: sa });
    tl({ kind: "subagent.start", title: "Subagent started: discovery", detail: threadId, status: "running" });
    status(turnId, "running", "searching", "click.command");
    await tool(token, "search_workspace", "click.command", { threadId, result: "9 matches in 3 files", ms: 520, args: { query: "click.command" } });
    await tool(token, "find_symbol", "routes_command", { threadId, result: "src/flask/cli.py:972", ms: 320, args: { name: "routes_command" } });
    await tool(token, "search_workspace", "flask routes", { threadId, result: "23 matches · tests/test_cli.py, docs/cli.rst", ms: 460, args: { query: "flask routes" } });
    emit("subagent.updated", { subagent: { ...sa, status: "done", endedAt: Date.now(), result: "src/flask/cli.py, tests/test_cli.py, docs/cli.rst" } });
    tl({ kind: "subagent.done", title: "Subagent finished", detail: "3 files identified", durationMs: 1300, status: "success" });

    // context bundle with budget
    status(turnId, "running", "reading", "get_context");
    await tool(token, "get_context", "CLI command + tests + docs · budget 24k", { args: { budgetTokens: 24000 }, result: "7 items · 14.3k / 24k tokens · 5 left out", ms: 640 });
    const ctx: ContextState = { ...TASK_B_CONTEXT, searches: TASK_B_CONTEXT.searches.map((s) => ({ ...s, at: Date.now() })) };
    emit("context.updated", { context: ctx });
    await stream(turnId, token, "Context assembled: **cli.py** (where commands live), **tests/test_cli.py** and **docs/cli.rst** ranked highest. Plan below.", "main");

    emit("plan.updated", { steps: taskBPlan(0) });
    await tool(token, "update_plan", "5 steps", { ms: 120 });
    await tool(token, "read_file", "src/flask/cli.py:940-1040", { result: "101 lines · routes_command found", ms: 280, args: { path: "src/flask/cli.py" } });
    emit("plan.updated", { steps: taskBPlan(1) });
    status(turnId, "running", "editing");
    await tool(token, "propose_edit", "src/flask/cli.py (3 hunks)", { result: "queued · +31 −0", ms: 360 });
    emit("plan.updated", { steps: taskBPlan(2) });
    await tool(token, "read_file", "tests/test_cli.py:660-700", { result: "41 lines", ms: 240, args: { path: "tests/test_cli.py" } });
    await tool(token, "propose_edit", "tests/test_cli.py (1 hunk)", { result: "queued · +19 −0", ms: 340 });
    emit("plan.updated", { steps: taskBPlan(3) });
    await tool(token, "read_file", "docs/cli.rst:30-60", { result: "31 lines", ms: 220, args: { path: "docs/cli.rst" } });
    await tool(token, "propose_edit", "docs/cli.rst (1 hunk)", { result: "queued · +11 −0", ms: 320 });
    review = { batchId: "batch_b", files: taskBFiles(), origin: "review_gate", summary: "Add `flask config`: masks SECRET/PASSWORD/TOKEN/KEY, registered on the CLI group, tested and documented." };
    emit("review.updated", { queue: review });
    emit("plan.updated", { steps: taskBPlan(4) });

    // approval-gated run_terminal
    status(turnId, "paused", "awaiting_approval", "run_terminal");
    const termId = nid("call");
    emit("conversation.append", { item: { kind: "approval", id: nid("it"), callId: termId } });
    emit("approval.requested", {
      approval: { callId: termId, tool: "run_terminal", command: "pytest tests/test_cli.py -q", reason: "Verify the new command against the proposed edits.", risk: "low", ranIn: "shadow", status: "pending" },
    });
    tl({ kind: "approval.requested", title: "Approval requested: run_terminal", detail: "pytest tests/test_cli.py -q", status: "warning" });
    const d = await new Promise<"allow" | "deny">((resolve) => decisions.set(termId, resolve));
    checkpoint(token);
    tl({ kind: "approval.decided", title: `Approval ${d === "allow" ? "allowed" : "denied"}: run_terminal`, status: d === "allow" ? "success" : "warning" });
    if (d === "allow") {
      status(turnId, "running", "verifying", "pytest tests/test_cli.py -q");
      await tool(token, "run_terminal", "pytest tests/test_cli.py -q", { result: "62 passed in 3.4s (shadow workspace)", ms: 1800, args: { command: "pytest tests/test_cli.py -q" } });
      tl({ kind: "test.run", title: "Tests passed in shadow workspace", detail: "62 passed", durationMs: 3400, status: "success" });
    }

    // review gate: submit_changes
    await stream(turnId, token, "Edits are proposed in 3 files. Submitting them for your review — nothing has been written to disk.", "main");
    const gateId = nid("call");
    review = { ...review, gateCallId: gateId };
    emit("review.updated", { queue: review });
    emit("conversation.append", { item: { kind: "approval", id: nid("it"), callId: gateId } });
    emit("approval.requested", {
      approval: { callId: gateId, tool: "submit_changes", reason: "The agent wants to apply its proposed edits.", summary: "3 files · 5 hunks · +61 −0", risk: "medium", status: "pending" },
    });
    status(turnId, "paused", "awaiting_approval", "submit_changes");
    tl({ kind: "approval.requested", title: "Review gate: submit_changes", detail: "TrueForge paused until you decide", status: "warning" });
    await new Promise<void>((resolve) => (applyWaiter = resolve));
    checkpoint(token);
    emit("approval.resolved", { callId: gateId, status: "allowed" });
    tl({ kind: "approval.decided", title: "Review gate decided", detail: "accepted hunks applied as one undoable batch", status: "success" });
    status(turnId, "running", "thinking");
    await sleep(500, token);
    await stream(turnId, token, "Applied. `flask config` is registered, tested (62 passed) and documented in `docs/cli.rst`.", "main");
    status(turnId, "done");
    tl({ kind: "turn.done", title: "Turn done", detail: "3 files · tests passing", status: "success" });
  }

  // ----- scenario C: resilience -----
  async function scenarioC(token: number, text: string, withFallback: boolean) {
    const turnId = nid("turn");
    const code: ErrorCode = withFallback ? "MODEL_AUTH" : "MODEL_UNREACHABLE";
    model = { primary: "custom/unreachable-endpoint", fallbacks: withFallback ? [FALLBACK] : [], active: "custom/unreachable-endpoint", status: "checking" };
    emit("model.status", { model });
    await begin(token, text, turnId);
    for (let attempt = 1; attempt <= (withFallback ? 1 : 3); attempt++) {
      model = { ...model, status: "degraded" };
      emit("model.status", { model });
      tl({ kind: "model.retry", title: `Model call failed (${code})`, detail: `attempt ${attempt}`, status: "error", code });
      if (!withFallback) {
        const delay = 800 * 2 ** (attempt - 1);
        status(turnId, "running", "retrying");
        emit("retry.scheduled", { attempt, maxAttempts: 3, delayMs: delay, code, model: "custom/unreachable-endpoint" });
        await sleep(delay + 150, token);
      }
    }
    if (withFallback) {
      // auth errors skip retries and go to the next fallback automatically (rubric B3 anchor 10)
      model = { primary: "custom/unreachable-endpoint", fallbacks: [FALLBACK], active: FALLBACK, status: "fallback_active", lastFailure: { code, action: "fell_back", at: Date.now() } };
      emit("model.status", { model });
      tl({ kind: "model.fallback", title: `Fell back to ${FALLBACK}`, detail: "no user action", status: "warning", code });
      await sleep(500, token);
      status(turnId, "running", "editing");
      await tool(token, "read_file", "src/flask/helpers.py:20-40", { result: "21 lines", ms: 240, args: { path: "src/flask/helpers.py" } });
      await stream(turnId, token, "Continuing on the fallback model. Adding `off` and `n` to the falsy set and updating the docstring.", "main");
      await tool(token, "propose_edit", "src/flask/helpers.py (2 hunks)", { result: "queued · +4 −2", ms: 300 });
      review = { batchId: "batch_c", files: taskAFiles(), origin: "inline_edit", summary: "get_debug_flag: also treat 'off' and 'n' as false (completed on fallback model)." };
      emit("review.updated", { queue: review });
      status(turnId, "done");
      tl({ kind: "turn.done", title: "Turn done on fallback model", status: "success" });
    } else {
      model = { ...model, status: "unreachable", lastFailure: { code, action: "stopped", at: Date.now() } };
      emit("model.status", { model });
      status(turnId, "error");
      emit("error.notify", {
        error: {
          id: nid("err"),
          code,
          title: "Can't reach the model",
          message: "TrueForge couldn't reach custom/unreachable-endpoint after 3 attempts. Check the endpoint in TrueForge, or add a fallback model.",
          action: { label: "Model configuration", intent: "openModelConfig" },
          details: "ECONNREFUSED 127.0.0.1:9 (3 attempts, backoff 0.8s / 1.6s / 3.2s)",
          workspaceUnchanged: true,
        },
      });
      tl({ kind: "turn.done", title: "Turn failed", detail: "workspace unchanged", status: "error", code });
    }
  }

  // ----- review reconciliation (host-side truth for the mock) -----
  const setHunks = (fn: (p: string, h: string, s: string) => string | null) => {
    review = {
      ...review,
      files: review.files.map((f) => ({ ...f, hunks: f.hunks.map((h) => ({ ...h, state: (fn(h.proposalId, h.hunkId, h.state) ?? h.state) as typeof h.state })) })),
    };
  };

  function applyBatch() {
    const hunks = review.files.flatMap((f) => f.hunks);
    const accepted = hunks.filter((h) => h.state === "accepted");
    setHunks((_p, _h, s) => (s === "accepted" ? "applied" : s));
    const files = new Set(review.files.filter((f) => f.hunks.some((h) => h.state === "applied")).map((f) => f.proposalId)).size;
    review = { ...review, gateCallId: undefined, lastApplied: { batchId: review.batchId ?? "batch", files, hunks: accepted.length, at: Date.now() } };
    emit("review.updated", { queue: review });
    if (accepted.length) emit("toast", { tone: "success", message: `Applied ${accepted.length} hunks in ${files} file${files === 1 ? "" : "s"}`, action: { label: "Undo", intent: "undo" } });
    else emit("toast", { tone: "info", message: "Nothing applied — all hunks rejected" });
  }

  function cancelRun() {
    const was = run;
    run += 1; // abort the active script
    decisions = new Map();
    applyWaiter = null;
    status(curTurn, "running", "cancelling");
    setTimeout(() => {
      // the workspace was never touched; queued proposals survive for explicit decisions
      emit("turn.status", { turn: { id: curTurn, status: "cancelled", startedAt: t0.v } });
      emit("conversation.append", { item: { kind: "notice", id: nid("n"), tone: "info", text: "Cancelled — nothing was written to your workspace.", at: Date.now() } });
      tl({ kind: "turn.done", title: "Turn cancelled", detail: "workspace unchanged", status: "warning" });
      if (review.files.length && !review.lastApplied) {
        review = { ...review, gateCallId: undefined, origin: "cancelled_turn" };
        emit("review.updated", { queue: review });
      }
      void was;
    }, 180 / speed);
  }

  // ----- host API -----
  const post = (m: WebviewToHost) => {
    switch (m.type) {
      case "ready":
        snapshot();
        break;
      case "task.submit": {
        const token = ++run;
        const text = m.payload.text;
        const pick: ScenarioId = scenario !== "auto" ? scenario : /flask config|cli command/i.test(text) ? "B" : "A";
        review = { batchId: null, files: [] };
        emit("review.updated", { queue: review });
        const go = pick === "B" ? scenarioB(token, text) : pick === "C-error" ? scenarioC(token, text, false) : pick === "C-fallback" ? scenarioC(token, text, true) : scenarioA(token, text);
        go.catch((e) => {
          if (!(e instanceof Aborted)) console.error("[mock] scenario failed", e);
        });
        break;
      }
      case "turn.cancel":
        cancelRun();
        break;
      case "approval.decide":
        decisions.get(m.payload.callId)?.(m.payload.decision);
        decisions.delete(m.payload.callId);
        emit("approval.resolved", { callId: m.payload.callId, status: m.payload.decision === "allow" ? "allowed" : "denied" });
        break;
      case "review.hunk":
        setHunks((p, h, s) => (p === m.payload.proposalId && h === m.payload.hunkId ? next(s, m.payload.action) : null));
        break;
      case "review.file":
        setHunks((p, _h, s) => (p === m.payload.proposalId ? next(s, m.payload.action) : null));
        break;
      case "review.bulk": {
        const a = m.payload.action;
        if (a === "acceptAll" || a === "rejectAll") setHunks((_p, _h, s) => next(s, a === "acceptAll" ? "accept" : "reject"));
        else if (a === "apply") {
          applyBatch();
          applyWaiter?.();
          applyWaiter = null;
        } else if (a === "undo") {
          setHunks((_p, _h, s) => (s === "applied" ? "undone" : null));
          review = { ...review, lastApplied: review.lastApplied ? { ...review.lastApplied, undone: true } : undefined };
          emit("review.updated", { queue: review });
          emit("toast", { tone: "info", message: "Reverted — files restored byte-for-byte" });
        }
        break;
      }
      case "model.test":
        emit("model.status", { model: { ...model, status: "checking" } });
        setTimeout(() => emit("model.status", { model }), 700 / speed);
        break;
      case "model.fallbacks":
        model = { ...model, fallbacks: m.payload.fallbacks };
        emit("model.status", { model });
        break;
      case "settings.update":
        snapshot({ settings: { ...DEFAULT_APP_STATE.settings, ...m.payload.patch } });
        break;
      case "session.new":
        review = { batchId: null, files: [] };
        run += 1;
        break;
      default:
        break;
    }
  };

  const next = (s: string, action: "accept" | "reject" | "reset"): string | null => {
    if (action === "accept" && (s === "pending" || s === "rejected")) return "accepted";
    if (action === "reject" && (s === "pending" || s === "accepted")) return "rejected";
    if (action === "reset" && (s === "accepted" || s === "rejected")) return "pending";
    return null;
  };

  return {
    kind: "mock",
    post,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    setScenario(id) {
      scenario = id;
      if (id === "C-error" || id === "C-fallback") {
        model = { primary: "custom/unreachable-endpoint", fallbacks: id === "C-fallback" ? [FALLBACK] : [], active: "custom/unreachable-endpoint", status: "unknown" };
      } else {
        model = { primary: PRIMARY, fallbacks: [FALLBACK], active: PRIMARY, status: "connected" };
      }
      emit("model.status", { model });
    },
    setSpeed(x) {
      speed = x;
    },
    reset() {
      run += 1;
      review = { batchId: null, files: [] };
      decisions = new Map();
      applyWaiter = null;
      model = { primary: PRIMARY, fallbacks: [FALLBACK], active: PRIMARY, status: "connected" };
      snapshot();
    },
  };
}
