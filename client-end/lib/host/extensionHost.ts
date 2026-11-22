/**
 * Adapter between the QuantForge extension host (packages/extension/src/controller.ts) and this UI.
 *
 * The extension speaks the wire format in packages/protocol: flat messages, one full `state.snapshot`
 * per change, coalesced `stream.delta`s and `mention.results`. The UI renders from incremental events
 * (lib/protocol). This module derives those events from successive snapshots, and translates UI intents
 * back into the extension's validated WebviewToHost messages. It holds no business logic: every decision
 * (apply, approve, cancel) is still made by the extension and TrueForge.
 */
import {
  messageId,
  type AppState,
  type ContextState,
  type ContextTier,
  type FileChange,
  type HostToWebview,
  type Hunk,
  type HunkState,
  type MentionCandidate,
  type ModelState,
  type PlanStep,
  type ReviewQueueState,
  type TimelineEvent,
  type TimelineKind,
  type ToolCall,
  type ToolName,
  type TurnPhase,
  type TurnState,
  type WebviewToHost,
} from "@/lib/protocol";
import { DEFAULT_APP_STATE } from "@/lib/store/reducer";

// ---------------------------------------------------------------- extension wire format (packages/protocol)
type ExtTimeline = { id: string; at: string; kind: string; title: string; detail?: string; status?: "running" | "ok" | "error" | "cancelled" };
type ExtHunk = { id: string; header: string; lines: { kind: "context" | "add" | "del"; text: string }[]; state: HunkState };
type ExtProposal = { id: string; path: string; kind: "modify" | "create" | "delete"; rationale: string; linesAdded: number; linesRemoved: number; hunks: ExtHunk[]; fromCancelledTurn?: boolean };
type ExtQueue = { batchId: string; proposals: ExtProposal[]; awaitingApproval: boolean; canUndo: boolean };
type ExtNotice = { level: "error" | "warn" | "info"; title: string; message: string; action?: { label: string; command: string } };
export type ExtState = {
  connection: "unknown" | "ok" | "down";
  model: string;
  fallbacks: string[];
  running: boolean;
  sessionId: string | null;
  messages: { role: "user" | "assistant"; text: string }[];
  stream: string;
  timeline: ExtTimeline[];
  plan: PlanStep[];
  context: { used: number; budget: number; items: { path: string; tier: string; tokens: number; reasons: string[] }[]; excluded: { path: string; reason: string }[] } | null;
  review: ExtQueue | null;
  approval: { callId: string; tool: string; detail: string } | null;
  notice: ExtNotice | null;
};
type ExtMention = { kind: "file" | "symbol"; label: string; insert: string; detail?: string };
type ExtIncoming =
  | { type: "state.snapshot"; state: ExtState }
  | { type: "stream.delta"; turnId: string; threadId: string; text: string }
  | { type: "mention.results"; query: string; items: ExtMention[] };

/** Outgoing messages the extension accepts (packages/protocol WebviewToHost). */
export type ExtOutgoing = { v: 1; id: string; type: string } & Record<string, unknown>;

// ---------------------------------------------------------------- helpers
const KNOWN_TOOLS = new Set<ToolName>([
  "read_file",
  "search_workspace",
  "find_symbol",
  "get_file_structure",
  "get_context",
  "propose_edit",
  "submit_changes",
  "run_terminal",
  "get_diagnostics",
  "get_git_status",
  "update_plan",
]);
const PHASE_BY_TOOL: Partial<Record<ToolName, TurnPhase>> = {
  read_file: "reading",
  get_file_structure: "reading",
  get_diagnostics: "reading",
  get_git_status: "reading",
  search_workspace: "searching",
  find_symbol: "searching",
  get_context: "searching",
  update_plan: "planning",
  propose_edit: "editing",
  submit_changes: "awaiting_approval",
  run_terminal: "verifying",
};
const TIERS = new Set<ContextTier>(["full", "symbols", "skeleton", "path"]);

/** Pull a readable one-liner out of a (possibly truncated) JSON argument string. */
export function summarizeArgs(raw: string | undefined): { summary: string; path?: string } {
  if (!raw) return { summary: "" };
  const pick = (key: string): string | undefined => new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(raw)?.[1];
  const path = pick("path");
  const range = /"startLine"\s*:\s*(\d+)[^}]*"endLine"\s*:\s*(\d+)/.exec(raw);
  const main = path ?? pick("query") ?? pick("name") ?? pick("command") ?? pick("summary") ?? pick("title");
  if (main) return { summary: range && path ? `${main}:${range[1]}-${range[2]}` : main, path };
  return { summary: raw.length > 80 ? `${raw.slice(0, 80)}…` : raw };
}

/** "@@ -27,6 +27,9 @@ …" → starting line numbers, so the diff can show a gutter. */
function hunkStart(header: string): { oldStart: number; newStart: number } | null {
  const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(header);
  return m ? { oldStart: Number(m[1]), newStart: Number(m[2]) } : null;
}

export function mapQueue(q: ExtQueue | null, gateCallId: string | undefined, lastApplied: ReviewQueueState["lastApplied"]): ReviewQueueState {
  if (!q) return { batchId: null, files: [], lastApplied };
  const files: FileChange[] = q.proposals.map((p) => {
    const hunks: Hunk[] = p.hunks.map((h, i) => {
      const start = hunkStart(h.header);
      let o = start?.oldStart ?? 0;
      let n = start?.newStart ?? 0;
      const lines = h.lines.map((l) => {
        if (!start) return { kind: l.kind, text: l.text };
        if (l.kind === "add") return { kind: l.kind, text: l.text, newNo: n++ };
        if (l.kind === "del") return { kind: l.kind, text: l.text, oldNo: o++ };
        return { kind: l.kind, text: l.text, oldNo: o++, newNo: n++ };
      });
      return {
        hunkId: h.id,
        proposalId: p.id,
        header: h.header,
        lines,
        state: h.state,
        rationale: i === 0 ? p.rationale : undefined,
        added: h.lines.filter((l) => l.kind === "add").length,
        removed: h.lines.filter((l) => l.kind === "del").length,
      };
    });
    return { proposalId: p.id, path: p.path, status: p.kind === "create" ? "A" : p.kind === "delete" ? "D" : "M", added: p.linesAdded, removed: p.linesRemoved, hunks };
  });
  const cancelled = q.proposals.some((p) => p.fromCancelledTurn);
  return {
    batchId: q.batchId,
    files,
    gateCallId: q.awaitingApproval ? gateCallId : undefined,
    origin: q.awaitingApproval ? "review_gate" : cancelled ? "cancelled_turn" : files.length ? "local_review" : undefined,
    lastApplied,
  };
}

export function mapContext(c: ExtState["context"]): ContextState | null {
  if (!c) return null;
  const n = c.items.length;
  return {
    usedTokens: c.used,
    budgetTokens: c.budget,
    // Items arrive ranked; the bar shows that rank (the extension does not expose raw scores).
    items: c.items.map((it, i) => ({
      path: it.path,
      tier: TIERS.has(it.tier as ContextTier) ? (it.tier as ContextTier) : "path",
      tokens: it.tokens,
      score: n > 1 ? 1 - (i / (n - 1)) * 0.8 : 1,
      reasons: it.reasons,
      source: it.reasons.some((r) => /mention/i.test(r)) ? "mention" : "get_context",
    })),
    excluded: c.excluded.map((e) => ({ path: e.path, reason: e.reason })),
    searches: [],
  };
}

function timelineKind(kind: string): TimelineKind {
  const map: Record<string, TimelineKind> = { retry: "model.retry", fallback: "model.fallback" };
  return (map[kind] ?? kind) as TimelineKind;
}
function timelineStatus(s: ExtTimeline["status"]): TimelineEvent["status"] {
  return s === "ok" ? "success" : s === "error" ? "error" : s === "cancelled" ? "warning" : s === "running" ? "running" : "info";
}

// ---------------------------------------------------------------- the adapter
export class ExtensionAdapter {
  private prev: ExtState | null = null;
  private seenMessages = 0;
  private seenTimeline = new Set<string>();
  private liveItem: string | null = null;
  private turnSeq = 0;
  private turn: TurnState = { id: null, status: "idle" };
  private openCalls: ToolCall[] = [];
  private openSubagent: string | null = null;
  private approvals = new Map<string, "pending" | "allowed" | "denied">();
  private fallbackTo: string | null = null;
  private fallbackFrom: string | null = null;
  private retrying = false;
  private lastQueueKey = "";
  private lastApplied: ReviewQueueState["lastApplied"];
  private applyIntent: { files: number; hunks: number } | null = null;
  private undoIntent = false;
  private noticeKey = "";
  private appKey = "";
  private ext: ExtState | null = null;

  constructor(
    private readonly emit: (m: HostToWebview) => void,
    private readonly send: (m: ExtOutgoing) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private out<T extends HostToWebview["type"]>(type: T, payload: Extract<HostToWebview, { type: T }>["payload"]): void {
    this.emit({ v: 1, id: messageId("x"), type, payload } as HostToWebview);
  }
  private sendExt(type: string, fields: Record<string, unknown> = {}): void {
    this.send({ v: 1, id: messageId("w").slice(0, 60), type, ...fields });
  }

  // -------------------------------------------------------------- inbound
  receive(raw: unknown): void {
    if (!raw || typeof raw !== "object" || typeof (raw as { type?: unknown }).type !== "string") return;
    const m = raw as ExtIncoming;
    if (m.type === "state.snapshot" && m.state && typeof m.state === "object") this.onSnapshot(m.state);
    else if (m.type === "stream.delta" && typeof m.text === "string") this.onDelta(m.text);
    else if (m.type === "mention.results" && Array.isArray(m.items)) {
      const items: MentionCandidate[] = m.items.map((i) =>
        i.kind === "symbol"
          ? { kind: "symbol", name: i.label, path: i.detail ?? "", insert: i.insert, detail: i.detail }
          : { kind: "file", path: i.label, insert: i.insert, detail: i.detail },
      );
      this.out("mention.results", { query: m.query, items });
    }
  }

  private onDelta(text: string): void {
    if (!this.turn.id || this.turn.status === "cancelling") return;
    if (!this.liveItem) {
      this.liveItem = messageId("asst");
      this.out("conversation.append", { item: { kind: "assistant", id: this.liveItem, threadId: "main", text: "", streaming: true, at: this.now() } });
    }
    this.out("stream.delta", { turnId: this.turn.id, threadId: "main", itemId: this.liveItem, text });
  }

  private onSnapshot(s: ExtState): void {
    const first = this.prev === null;
    this.ext = s;
    const startedRun = s.running && !this.prev?.running;
    const endedRun = !s.running && Boolean(this.prev?.running);

    if (startedRun) {
      this.turnSeq += 1;
      this.turn = { id: `t${this.turnSeq}`, status: "running", phase: "thinking", startedAt: this.now(), model: s.model || undefined };
      this.fallbackTo = null;
      this.fallbackFrom = null;
      this.retrying = false;
      this.openCalls = [];
      this.openSubagent = null;
    }

    // Messages before timeline keeps "assistant text, then the tool it called" in order; the model state is
    // computed after the timeline because retry/fallback events change it.
    this.syncMessages(s, first);
    this.syncTimeline(s);
    this.syncApp(s, first);
    this.syncApproval(s);
    this.syncReview(s);
    this.syncContextAndPlan(s);
    this.syncNotice(s);
    this.syncTurn(s, endedRun);
    this.prev = s;
  }

  private modelState(s: ExtState): ModelState {
    const primary = s.model || null;
    const status: ModelState["status"] =
      s.connection === "down"
        ? "unreachable"
        : this.fallbackTo
          ? "fallback_active"
          : this.retrying
            ? "degraded"
            : s.notice?.level === "error" && /auth|key|401|forbidden/i.test(`${s.notice.title} ${s.notice.message}`)
              ? "auth_failed"
              : s.connection === "ok"
                ? "connected"
                : "checking";
    return {
      primary,
      fallbacks: s.fallbacks ?? [],
      active: this.fallbackTo ?? primary,
      status,
      lastFailure: this.fallbackTo ? { code: "MODEL_UNAVAILABLE", action: "fell_back", at: this.now() } : undefined,
    };
  }

  private syncApp(s: ExtState, first: boolean): void {
    const key = JSON.stringify([s.connection, s.model, s.fallbacks, s.sessionId, s.messages[0]?.text ?? ""]);
    const model = this.modelState(s);
    if (first || key !== this.appKey) {
      this.appKey = key;
      const title = s.messages.find((m) => m.role === "user")?.text.slice(0, 60) ?? "New session";
      const state: AppState = {
        ...DEFAULT_APP_STATE,
        connection: { status: s.connection === "ok" ? "connected" : s.connection === "down" ? "unreachable" : "checking", baseUrl: "http://localhost:8790" },
        model,
        sessions: s.sessionId ? [{ id: s.sessionId, title, createdAt: this.now(), turns: this.turnSeq, agent: "forge-agent" }] : [],
        activeSessionId: s.sessionId,
        turn: this.turn,
      };
      this.out("state.snapshot", { state });
    } else {
      this.out("model.status", { model });
    }
  }

  private syncMessages(s: ExtState, first: boolean): void {
    const msgs = s.messages ?? [];
    if (msgs.length < this.seenMessages) this.seenMessages = 0; // "New session" cleared the log
    for (let i = this.seenMessages; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.role === "user") {
        this.out("conversation.append", { item: { kind: "user", id: messageId("u"), text: m.text, mentions: [], at: this.now() } });
      } else if (this.liveItem) {
        this.out("stream.end", { itemId: this.liveItem });
        this.liveItem = null;
      } else {
        this.out("conversation.append", { item: { kind: "assistant", id: messageId("asst"), threadId: "main", text: m.text, streaming: false, at: this.now() } });
      }
    }
    this.seenMessages = msgs.length;
    // After a window reload mid-run, show what had already streamed.
    if (first && s.running && s.stream) this.onDelta(s.stream);
  }

  private syncTimeline(s: ExtState): void {
    for (const e of s.timeline ?? []) {
      if (this.seenTimeline.has(e.id)) continue;
      this.seenTimeline.add(e.id);
      const at = Date.parse(e.at) || this.now();
      if (e.kind === "tool.call") this.onToolCall(e, at);
      else if (e.kind === "tool.result") this.onToolResult(e, at);
      else if (e.kind === "subagent.start") {
        const threadId = messageId("thr");
        this.openSubagent = threadId;
        this.out("conversation.append", { item: { kind: "subagent", id: messageId("it"), threadId } });
        this.out("subagent.updated", { subagent: { threadId, title: e.title.replace(/^subagent:\s*/, ""), status: "running", steps: [], startedAt: at } });
      } else if (e.kind === "subagent.done" && this.openSubagent) {
        const threadId = this.openSubagent;
        this.openSubagent = null;
        this.out("subagent.updated", { subagent: { threadId, title: "", status: e.status === "error" ? "failed" : "done", steps: [], startedAt: at, endedAt: at } });
      } else if (e.kind === "approval.decided") {
        const [tool, decision] = e.title.split(":").map((x) => x.trim());
        for (const [callId, st] of this.approvals) {
          if (st === "pending") {
            this.approvals.set(callId, decision === "allow" ? "allowed" : "denied");
            this.out("approval.resolved", { callId, status: decision === "allow" ? "allowed" : "denied" });
          }
        }
        void tool;
      } else if (e.kind === "retry") {
        this.retrying = true;
        const attempt = Number(/retry (\d+)/.exec(e.title)?.[1] ?? 1);
        const delayMs = Number(/in (\d+) ms/.exec(e.title)?.[1] ?? 1000);
        this.out("retry.scheduled", { attempt, maxAttempts: Math.max(3, attempt + 1), delayMs, code: e.detail ?? "Model error", model: this.fallbackTo ?? s.model });
      } else if (e.kind === "fallback") {
        this.retrying = false;
        this.fallbackFrom = s.model;
        this.fallbackTo = e.title.replace(/^fallback\s*→\s*/, "").trim() || null;
      }
      const ev: TimelineEvent = {
        id: e.id,
        kind: timelineKind(e.kind),
        at,
        title: e.title,
        detail: e.detail,
        status: timelineStatus(e.status),
      };
      this.out("timeline.event", { event: ev });
    }
  }

  private onToolCall(e: ExtTimeline, at: number): void {
    const tool = e.title as ToolName;
    const { summary, path } = summarizeArgs(e.detail);
    const call: ToolCall = {
      callId: messageId("call"),
      tool: KNOWN_TOOLS.has(tool) ? tool : ("read_file" as ToolName),
      summary: KNOWN_TOOLS.has(tool) ? summary : `${e.title} ${summary}`.trim(),
      args: path ? { path } : undefined,
      status: "running",
      startedAt: at,
      threadId: this.openSubagent ?? undefined,
    };
    this.openCalls.push(call);
    this.out("conversation.append", { item: { kind: "tool", id: messageId("it"), callId: call.callId } });
    this.out("tool.updated", { call });
    const phase = PHASE_BY_TOOL[call.tool];
    if (phase && this.turn.status === "running") {
      this.turn = { ...this.turn, phase, phaseDetail: summary };
      this.out("turn.status", { turn: this.turn });
    }
  }

  private onToolResult(e: ExtTimeline, at: number): void {
    const i = this.openCalls.findIndex((c) => c.tool === e.title || (!KNOWN_TOOLS.has(e.title as ToolName) && c.summary.startsWith(e.title)));
    const call = i >= 0 ? this.openCalls.splice(i, 1)[0] : this.openCalls.shift();
    if (!call) return;
    const preview = (e.detail ?? "").replace(/\s+/g, " ").trim();
    this.out("tool.updated", {
      call: {
        ...call,
        status: e.status === "error" ? "failed" : "succeeded",
        durationMs: Math.max(0, at - call.startedAt),
        resultSummary: e.status === "error" ? undefined : preview.slice(0, 90) || undefined,
        error: e.status === "error" ? preview.slice(0, 200) : undefined,
      },
    });
  }

  private syncApproval(s: ExtState): void {
    const a = s.approval;
    if (a && !this.approvals.has(a.callId)) {
      this.approvals.set(a.callId, "pending");
      const [first, ...rest] = a.detail.split("\n");
      const isGate = a.tool === "submit_changes";
      this.out("conversation.append", { item: { kind: "approval", id: messageId("it"), callId: a.callId } });
      this.out("approval.requested", {
        approval: isGate
          ? { callId: a.callId, tool: "submit_changes", summary: first || "Proposed changes", reason: "Review each hunk, then apply.", risk: "medium", status: "pending" }
          : {
              callId: a.callId,
              tool: "run_terminal",
              command: first,
              reason: rest.map((l) => l.replace(/^—\s*/, "")).filter((l) => !l.startsWith("(")).join(" ") || "The agent wants to run a command.",
              risk: "low",
              ranIn: rest.some((l) => /disposable copy/.test(l)) ? "shadow" : "workspace",
              status: "pending",
            },
      });
    }
  }

  private gateCallId(): string | undefined {
    const a = this.ext?.approval;
    return a?.tool === "submit_changes" ? a.callId : undefined;
  }

  private syncReview(s: ExtState): void {
    const canUndo = Boolean(s.review?.canUndo);
    const couldUndo = Boolean(this.prev?.review?.canUndo);
    if (canUndo && (!couldUndo || this.applyIntent)) {
      const counts = this.applyIntent ?? { files: 1, hunks: 1 };
      this.lastApplied = { batchId: s.review?.batchId ?? "batch", files: counts.files, hunks: counts.hunks, at: this.now() };
      if (this.applyIntent) this.out("toast", { tone: "success", message: `Applied ${counts.hunks} hunk${counts.hunks === 1 ? "" : "s"} in ${counts.files} file${counts.files === 1 ? "" : "s"}`, action: { label: "Undo", intent: "undo" } });
      this.applyIntent = null;
    } else if (!canUndo && couldUndo && this.lastApplied) {
      this.lastApplied = { ...this.lastApplied, undone: true };
      if (this.undoIntent) this.out("toast", { tone: "info", message: "Reverted — files restored exactly" });
    }
    this.undoIntent = false;
    const queue = mapQueue(s.review, this.gateCallId(), this.lastApplied);
    const key = JSON.stringify(queue);
    if (key !== this.lastQueueKey) {
      this.lastQueueKey = key;
      this.out("review.updated", { queue });
    }
  }

  private lastContextKey = "";
  private lastPlanKey = "";
  private syncContextAndPlan(s: ExtState): void {
    const ctx = mapContext(s.context);
    const ck = JSON.stringify(ctx);
    if (ctx && ck !== this.lastContextKey) {
      this.lastContextKey = ck;
      this.out("context.updated", { context: ctx });
    }
    const pk = JSON.stringify(s.plan ?? []);
    if (pk !== this.lastPlanKey) {
      this.lastPlanKey = pk;
      this.out("plan.updated", { steps: s.plan ?? [] });
    }
  }

  private syncNotice(s: ExtState): void {
    const n = s.notice;
    const key = n ? `${n.level}|${n.title}|${n.message}` : "";
    if (key === this.noticeKey) return;
    this.noticeKey = key;
    this.out("error.clear", { id: "notice" });
    if (!n) return;
    // Notices the UI shows in a more specific place:
    if (/^Retrying/i.test(n.title)) return; // retry banner (from the timeline)
    if (/^Switched to fallback model/i.test(n.title)) return; // fallback banner + model chip
    if (/^Changes are waiting for your review/i.test(n.title)) return; // review bar
    if (n.level === "info" && /^Cancelled/i.test(n.title)) {
      this.out("conversation.append", { item: { kind: "notice", id: messageId("n"), tone: "info", text: "Cancelled — nothing was written to your files.", at: this.now() } });
      return;
    }
    const unchanged = /(Your files were not changed|Nothing was written)/i.test(n.message);
    const message = n.message.replace(/\s*Your files were not changed\.?/i, "").trim();
    const code = /TrueForge is not reachable/i.test(n.title) ? "TRUEFORGE_UNREACHABLE" : undefined;
    this.out("error.notify", {
      error: {
        id: "notice",
        code,
        tone: n.level === "error" ? "danger" : n.level === "warn" ? "warning" : "info",
        title: n.title,
        message,
        workspaceUnchanged: unchanged || undefined,
        action: n.action ? { label: n.action.label, intent: "command", command: n.action.command } : undefined,
      },
    });
  }

  private syncTurn(s: ExtState, endedRun: boolean): void {
    if (!this.turn.id) return;
    if (endedRun) {
      if (this.liveItem) {
        this.out("stream.end", { itemId: this.liveItem });
        this.liveItem = null;
      }
      for (const [callId, st] of this.approvals) {
        if (st === "pending") {
          this.approvals.set(callId, "denied");
          this.out("approval.resolved", { callId, status: "denied" });
        }
      }
      const status: TurnState["status"] =
        this.turn.status === "cancelling" || (s.notice?.level === "info" && /^Cancelled/i.test(s.notice.title))
          ? "cancelled"
          : s.notice?.level === "error"
            ? "error"
            : "done";
      this.turn = { ...this.turn, status, endedAt: this.now(), phase: undefined };
      this.retrying = false;
      this.out("turn.status", { turn: this.turn });
      return;
    }
    if (!s.running) return;
    const paused = Boolean(s.approval);
    const next: TurnState = paused
      ? { ...this.turn, status: "paused", phase: "awaiting_approval", phaseDetail: s.approval?.tool, model: this.fallbackTo ?? (s.model || undefined) }
      : {
          ...this.turn,
          status: "running",
          phase: this.retrying ? "retrying" : this.turn.phase === "awaiting_approval" ? "thinking" : this.turn.phase,
          model: this.fallbackTo ?? (s.model || undefined),
        };
    if (this.turn.status === "cancelling") return;
    this.turn = next;
    this.out("turn.status", { turn: this.turn });
  }

  // -------------------------------------------------------------- outbound
  handle(m: WebviewToHost): void {
    const s = this.ext;
    switch (m.type) {
      case "ready":
        this.sendExt("ready");
        break;
      case "task.submit":
        this.sendExt("task.submit", { text: m.payload.text, mentions: [] });
        break;
      case "turn.cancel":
        if (this.turn.status === "running" || this.turn.status === "paused") this.turn = { ...this.turn, status: "cancelling", phase: "cancelling" };
        this.sendExt("turn.cancel", { sessionId: s?.sessionId ?? "-" });
        break;
      case "approval.decide":
        this.sendExt("approval.decide", { callId: m.payload.callId, decision: m.payload.decision, ...(m.payload.reason ? { reason: m.payload.reason } : {}) });
        break;
      case "review.hunk":
        if (m.payload.action === "reset") this.lastQueueKey = ""; // not supported by the extension: re-sync shows the host's truth
        else this.sendExt("review.hunk", { proposalId: m.payload.proposalId, hunkId: m.payload.hunkId, action: m.payload.action });
        if (m.payload.action === "reset" && s) this.syncReview(s);
        break;
      case "review.file": {
        const p = s?.review?.proposals.find((x) => x.id === m.payload.proposalId);
        for (const h of p?.hunks ?? []) if (h.state === "pending" || h.state === "accepted" || h.state === "rejected") this.sendExt("review.hunk", { proposalId: p!.id, hunkId: h.id, action: m.payload.action });
        break;
      }
      case "review.bulk": {
        const action = m.payload.action;
        if (action === "apply") {
          const props = s?.review?.proposals ?? [];
          const accepted = props.flatMap((p) => p.hunks.filter((h) => h.state === "accepted"));
          this.applyIntent = { hunks: accepted.length, files: props.filter((p) => p.hunks.some((h) => h.state === "accepted")).length };
          const gate = this.gateCallId();
          // While TrueForge is paused on submit_changes, applying IS the approval (the extension applies accepted hunks).
          if (gate && s?.review?.awaitingApproval) this.sendExt("approval.decide", { callId: gate, decision: accepted.length ? "allow" : "deny", ...(accepted.length ? {} : { reason: "the developer rejected every hunk" }) });
          else this.sendExt("review.bulk", { action: "apply" });
        } else {
          if (action === "undo") this.undoIntent = true;
          this.sendExt("review.bulk", { action });
        }
        break;
      }
      case "diff.open":
        this.sendExt("review.openDiff", { proposalId: m.payload.proposalId });
        break;
      case "file.open":
        this.sendExt("file.open", { path: m.payload.path, ...(m.payload.line ? { line: m.payload.line } : {}) });
        break;
      case "mention.query":
        this.sendExt("mention.query", { query: m.payload.query.slice(0, 200) });
        break;
      case "command.run":
        if (/^forge\.[A-Za-z.]+$/.test(m.payload.command)) this.sendExt("command.run", { command: m.payload.command });
        break;
      case "connection.check":
      case "model.test":
        this.sendExt("command.run", { command: "forge.checkConnection" });
        break;
      case "trueforge.start":
        this.sendExt("command.run", { command: "forge.startTrueForge" });
        break;
      case "session.new":
        this.sendExt("command.run", { command: "forge.newSession" });
        break;
      default:
        // settings.update, model.fallbacks, session.select, session.openInTrueForge: handled by VS Code settings/commands
        break;
    }
  }
}
