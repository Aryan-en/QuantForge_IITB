import * as vscode from "vscode";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { parseMentions } from "@forge/context-engine";
import { createToolContext, startForgeMcpHttp, type ForgeEvent, type RunningServer, type ToolContext } from "@forge/editor-mcp";
import { loadAgent, runResilient, TrueForgeApi, type AgentSpec, type ApprovalDecision, type ForgeStreamEvent, type Notice, type ToolCallInfo } from "@forge/trueforge-client";
import { parseWebviewMessage, type PlanStep, type ReviewQueueState, type TimelineEvent, type UserFacingError, type WebviewToHost } from "@forge/protocol";
import { VsCodeFileStore } from "./vscodeStore.js";
import { openDiff, ReviewLensProvider } from "./reviewUi.js";

interface Notice2 { level: "error" | "warn" | "info"; title: string; message: string; action?: { label: string; command: string } }
interface AppState {
  connection: "unknown" | "ok" | "down";
  model: string;
  running: boolean;
  sessionId: string | null;
  messages: { role: "user" | "assistant"; text: string }[];
  stream: string;
  timeline: TimelineEvent[];
  plan: PlanStep[];
  context: { used: number; budget: number; items: { path: string; tier: string; tokens: number; reasons: string[] }[]; excluded: { path: string; reason: string }[] } | null;
  review: ReviewQueueState | null;
  approval: { callId: string; tool: string; detail: string } | null;
  notice: Notice2 | null;
}

const cfg = <T>(k: string, d: T): T => vscode.workspace.getConfiguration("forge").get<T>(k, d);
const ts = (): string => new Date().toISOString();

export class ForgeController implements vscode.Disposable {
  private tool!: ToolContext;
  private srv: RunningServer | null = null;
  private api!: TrueForgeApi;
  private view: vscode.Webview | null = null;
  private abort: AbortController | null = null;
  private pending: { call: ToolCallInfo; resolve: (d: ApprovalDecision) => void } | null = null;
  private seq = 0;
  readonly lens: ReviewLensProvider;
  readonly state: AppState = { connection: "unknown", model: "", running: false, sessionId: null, messages: [], stream: "", timeline: [], plan: [], context: null, review: null, approval: null, notice: null };
  private inlineMode = false;

  constructor(private readonly ext: vscode.ExtensionContext, private readonly out: vscode.OutputChannel) {
    this.lens = new ReviewLensProvider({ list: () => this.tool?.review.list() ?? [] } as never, () => this.root());
  }

  get review() { return this.tool.review; }
  root(): vscode.Uri | undefined { return vscode.workspace.workspaceFolders?.[0]?.uri; }
  log(s: string): void { this.out.appendLine(`[${ts()}] ${s}`); }

  async init(): Promise<void> {
    const root = this.root();
    if (!root) { this.notice({ level: "warn", title: "Open a folder", message: "FORGE works on the folder open in the editor." }); return; }
    const storage = path.join(this.ext.globalStorageUri.fsPath, createHash("sha1").update(root.fsPath).digest("hex").slice(0, 12));
    const pyBin = cfg("agent.pythonBin", "");
    this.tool = await createToolContext({
      root: root.fsPath, storageDir: storage, persistJournal: true,
      store: new VsCodeFileStore(root), shadow: cfg("agent.shadowWorkspace", true), excludeGlobs: cfg<string[]>("context.exclude", []),
      extraPath: pyBin ? [pyBin] : undefined,
      diagnostics: async (paths, severity) => {
        const out: { path: string; line: number; severity: "error" | "warning" | "info" | "hint"; message: string; source?: string }[] = [];
        for (const [uri, ds] of vscode.languages.getDiagnostics()) {
          const rel = vscode.workspace.asRelativePath(uri, false);
          if (paths && !paths.includes(rel)) continue;
          for (const d of ds) {
            const sev = (["error", "warning", "info", "hint"] as const)[d.severity] ?? "info";
            if (severity === "error" && sev !== "error") continue;
            if (severity === "warning" && sev !== "error" && sev !== "warning") continue;
            out.push({ path: rel, line: d.range.start.line + 1, severity: sev, message: d.message, ...(d.source ? { source: d.source } : {}) });
          }
        }
        return out;
      },
      onEvent: (e) => this.onToolEvent(e),
    });
    this.tool.turnId = () => String(this.seq);
    this.api = new TrueForgeApi(cfg("trueforge.baseUrl", "http://localhost:8790"));
    this.srv = await startForgeMcpHttp(this.tool);
    this.log(`MCP server listening on ${this.srv.url}`);
    await this.checkConnection();
  }

  /** Probe TrueForge and (re)register FORGE's loopback MCP server in it. Never throws. */
  async checkConnection(): Promise<void> {
    if (!this.srv) return;
    const url = cfg("trueforge.baseUrl", "http://localhost:8790");
    try { this.api = new TrueForgeApi(url); } catch (e) { this.setConnection("down", String(e)); return; }
    const p = await this.api.probe();
    if (!p.ok) { this.setConnection("down", p.message); return; }
    try {
      await this.api.upsertMcpServer({ name: "forge-editor", url: this.srv.url, token: this.srv.token });
      this.state.notice = null;
      this.setConnection("ok");
    } catch (e) {
      this.setConnection("ok");
      this.notice({ level: "error", title: "Could not register FORGE tools in TrueForge", message: (e as Error).message, action: { label: "Start TrueForge correctly", command: "forge.startTrueForge" } });
    }
    this.state.model = cfg("model.primary", "");
    this.push();
  }
  private setConnection(c: "ok" | "down", why?: string): void {
    this.state.connection = c;
    if (c === "down") this.notice({ level: "error", title: "TrueForge is not reachable", message: `${why ?? ""} Start it with “FORGE: Start TrueForge” and check forge.trueforge.baseUrl.`, action: { label: "Start TrueForge", command: "forge.startTrueForge" } });
    this.push();
  }

  // ------------------------------------------------------------------ webview plumbing
  attach(webview: vscode.Webview): void {
    this.view = webview;
    webview.onDidReceiveMessage((raw: unknown) => void this.onMessage(raw));
    this.push();
  }
  private post(m: object): void { void this.view?.postMessage({ v: 1, id: String(++this.seq), ...m }); }
  push(): void {
    if (this.tool) this.state.review = this.tool.review.view(this.state.approval?.tool === "submit_changes");
    this.state.model = cfg("model.primary", "");
    this.lens.refresh();
    this.post({ type: "state.snapshot", state: this.state });
  }
  private notice(n: Notice2 | null): void { this.state.notice = n; this.push(); }
  private timeline(e: Omit<TimelineEvent, "id" | "at">): void {
    this.state.timeline.push({ id: String(++this.seq), at: ts(), ...e });
    if (this.state.timeline.length > 500) this.state.timeline.shift();
  }

  private async onMessage(raw: unknown): Promise<void> {
    const r = parseWebviewMessage(raw);
    if (!r.ok) { this.log(`dropped invalid webview message: ${r.error}`); return; }
    const m: WebviewToHost = r.msg;
    switch (m.type) {
      case "ready": this.push(); break;
      case "task.submit": void this.runTask(m.text, "agent"); break;
      case "turn.cancel": this.cancel(); break;
      case "approval.decide": this.decideApproval(m.callId, m.decision, m.reason); break;
      case "review.hunk": {
        this.tool.review.decide(m.proposalId, m.hunkId, m.action);
        this.push(); break;
      }
      case "review.bulk": await this.bulk(m.action); break;
      case "review.openDiff": { const root = this.root(); if (root) await openDiff(this.tool.review, m.proposalId, root); break; }
      case "command.run": await vscode.commands.executeCommand(m.command); break;
      case "settings.update": break; // settings live in VS Code settings (forge.*); the sidebar has no editable fields yet
    }
  }

  async bulk(action: "acceptAll" | "rejectAll" | "apply" | "undo"): Promise<void> {
    if (!this.tool) return;
    if (action === "acceptAll") this.tool.review.decideAll("accept");
    else if (action === "rejectAll") this.tool.review.decideAll("reject");
    else if (action === "apply") {
      const rep = await this.tool.review.apply({ rejectUndecided: true });
      this.tool.review.clearSettled();
      vscode.window.setStatusBarMessage(rep.ok ? `FORGE: applied ${rep.filesChanged.length} file(s) — undo with “FORGE: Undo Last Applied Batch”` : "FORGE: applying failed; nothing was changed", 6000);
    } else if (action === "undo") {
      const u = await this.tool.review.undo();
      if (!u.ok) void vscode.window.showWarningMessage(u.conflicts.length ? `Cannot undo: ${u.conflicts.join(", ")} changed since FORGE applied it.` : "Nothing to undo.");
      else vscode.window.setStatusBarMessage(`FORGE: restored ${u.restored.length} file(s)`, 5000);
    }
    this.push();
  }

  // ------------------------------------------------------------------ approvals
  decideApproval(callId: string, decision: "allow" | "deny", reason?: string): void {
    const p = this.pending;
    if (!p || p.call.callId !== callId) return;
    this.pending = null;
    this.state.approval = null;
    if (p.call.tool === "submit_changes") {
      const accepted = this.tool.review.list().some((x) => [...x.states.values()].includes("accepted"));
      if (decision === "allow" && !accepted) { p.resolve({ status: "deny", reason: "the developer accepted no hunks" }); this.tool.review.decideAll("reject"); this.push(); return; }
      if (decision === "deny") this.tool.review.decideAll("reject");
    }
    this.timeline({ kind: "approval.decided", title: `${p.call.tool}: ${decision}`, status: "ok" });
    p.resolve(decision === "allow" ? { status: "allow" } : { status: "deny", reason: reason ?? "denied by the developer" });
    this.push();
  }

  private approvalFor(call: ToolCallInfo): Promise<ApprovalDecision> {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(call.args) as Record<string, unknown>; } catch { /* leave empty */ }
    let detail = call.tool === "run_terminal" ? `${String(args.command ?? "")}\n— ${String(args.reason ?? "")}` : `${String(args.summary ?? "")}\n${this.tool.review.list().length} file(s) proposed. Review each hunk, then apply.`;
    if (call.tool === "run_terminal") detail += "\n(runs in a disposable copy that includes the proposed edits)";
    this.timeline({ kind: "approval.requested", title: `approval: ${call.tool}`, detail: detail.split("\n")[0], status: "running" });
    return new Promise<ApprovalDecision>((resolve) => {
      this.pending = { call, resolve };
      this.state.approval = { callId: call.callId, tool: call.tool, detail };
      this.push();
      if (cfg("review.autoOpenOnPause", true)) void vscode.commands.executeCommand("forge.sidebar.focus");
      if (this.inlineMode && call.tool === "submit_changes") void this.inlinePrompt(call);
    });
  }

  /** Inline edit: review happens in the editor (CodeLens per hunk); a notification collects the final decision. */
  private async inlinePrompt(call: ToolCallInfo): Promise<void> {
    const first = this.tool.review.list()[0];
    const root = this.root();
    if (first && root) await vscode.window.showTextDocument(vscode.Uri.joinPath(root, first.path), { preview: false });
    this.lens.refresh();
    const pick = await vscode.window.showInformationMessage(`FORGE proposes changes to ${this.tool.review.list().map((p) => p.path).join(", ")}. Use Accept/Reject above each hunk, then apply.`, "Accept all & apply", "Apply accepted", "Reject all");
    if (!this.pending || this.pending.call.callId !== call.callId) return;
    if (pick === "Accept all & apply") { this.tool.review.decideAll("accept"); this.decideApproval(call.callId, "allow"); }
    else if (pick === "Apply accepted") this.decideApproval(call.callId, "allow");
    else if (pick === "Reject all") this.decideApproval(call.callId, "deny");
  }

  // ------------------------------------------------------------------ running tasks
  cancel(): void {
    if (!this.abort) return;
    this.log("cancel requested");
    this.timeline({ kind: "turn.done", title: "cancelling…", status: "running" });
    this.abort.abort();
    this.tool.cancel.cancel("user pressed Stop"); // TrueForge waits for running MCP calls, so FORGE aborts its own
    this.pending?.resolve({ status: "deny", reason: "cancelled" });
    this.pending = null;
    this.state.approval = null;
    this.push();
  }

  async runTask(rawText: string, mode: "agent" | "inline", inlineHeader = ""): Promise<void> {
    if (!this.tool) { await vscode.window.showWarningMessage("Open a folder to use FORGE."); return; }
    if (this.state.running) return;
    if (!vscode.workspace.isTrusted) { this.notice({ level: "warn", title: "Workspace not trusted", message: "FORGE is read-only in untrusted workspaces." }); return; }
    const primary = cfg("model.primary", "").trim();
    if (!primary) { this.notice({ level: "error", title: "No model selected", message: "Set forge.model.primary to a model configured in TrueForge (Settings → Models), e.g. “openai/gpt-…”.", action: { label: "Open settings", command: "forge.openSettings" } }); return; }
    const models = [primary, ...cfg<string[]>("model.fallbacks", []).filter((m) => m && m !== primary)];
    await this.checkConnection();
    if (this.state.connection !== "ok") return;

    const { mentions, text } = parseMentions(rawText);
    const prompt = `${inlineHeader}${text}${mentions.length ? `\n\n[FORGE mentions — pass these as \`mentions\` to get_context]\n${JSON.stringify(mentions)}` : ""}`;
    const specs = new Map<string, AgentSpec>();
    try {
      for (const m of models) specs.set(m, (await loadAgent(path.join(this.ext.extensionPath, "agents"), mode === "agent" ? "forge-agent" : "forge-inline-edit", { model: m })).spec);
    } catch (e) { this.notice({ level: "error", title: "Agent definition missing", message: String(e) }); return; }

    this.inlineMode = mode === "inline";
    this.abort = new AbortController();
    this.seq++;
    Object.assign(this.state, { running: true, stream: "", notice: null, plan: mode === "agent" ? [] : this.state.plan });
    this.state.messages.push({ role: "user", text: rawText });
    void vscode.commands.executeCommand("setContext", "forge.running", true);
    this.timeline({ kind: "session.start", title: `${mode} task`, detail: models.join(" → "), status: "running" });
    this.push();

    try {
      const res = await runResilient(this.api, {
        text: prompt, models, specFor: (m) => specs.get(m)!, signal: this.abort.signal, stallTimeoutMs: cfg("stallTimeoutMs", 45000),
        onEvent: (e) => this.onStream(e), onNotice: (n) => this.onNotice(n), onApproval: (c) => this.approvalFor(c),
        describeProgress: () => { const q = this.tool.review.list(); return q.length ? `Edits already proposed (still queued): ${q.map((p) => p.path).join(", ")}. Do not re-propose them.` : "No edits were queued yet."; },
      });
      this.state.sessionId = res.sessionId;
      if (res.outcome?.status === "cancelled") {
        this.tool.review.markTurnCancelled(String(this.seq));
        this.notice({ level: "info", title: "Cancelled", message: "Nothing was written to your files. Proposals made before you stopped (if any) are in Review and need your explicit decision." });
      } else if (res.error || res.outcome?.status === "error") {
        const e: UserFacingError = res.error ?? { code: "UNKNOWN", title: "The agent run failed", message: res.outcome?.errorMessage ?? "" };
        this.notice({ level: "error", title: e.title, message: `${e.message} Your files were not changed.`, ...(e.action ? { action: e.action } : {}) });
      }
      if (this.state.stream) { this.state.messages.push({ role: "assistant", text: this.state.stream }); this.state.stream = ""; }
    } catch (e) {
      this.notice({ level: "error", title: "Unexpected error", message: String(e) });
    } finally {
      this.abort = null; this.pending = null; this.state.approval = null; this.inlineMode = false;
      this.state.running = false;
      void vscode.commands.executeCommand("setContext", "forge.running", false);
      // Safety net: a model may skip submit_changes. Leftover proposals still go through human review.
      const left = this.tool.review.list().filter((p) => [...p.states.values()].some((s) => s === "pending" || s === "accepted"));
      if (left.length && !this.state.notice) this.notice({ level: "info", title: "Changes are waiting for your review", message: `${left.length} file(s) proposed but not applied. Open the Review tab to accept or reject each hunk.` });
      this.push();
    }
  }

  private onStream(e: ForgeStreamEvent): void {
    switch (e.type) {
      case "text.delta": if (e.threadId === "main") { this.state.stream += e.text; this.post({ type: "stream.delta", turnId: String(this.seq), threadId: e.threadId, text: e.text }); } break;
      case "message.complete": if (e.threadId === "main" && this.state.stream && !e.text) { /* tool-call-only message */ } break;
      case "tool.call": this.timeline({ kind: "tool.call", title: e.call.tool, detail: e.call.args.slice(0, 120), status: "running" }); if (this.state.stream) { this.state.messages.push({ role: "assistant", text: this.state.stream }); this.state.stream = ""; } this.push(); break;
      case "tool.result": this.timeline({ kind: "tool.result", title: e.tool ?? "tool", detail: e.preview.slice(0, 120), status: e.ok ? "ok" : "error" }); this.push(); break;
      case "subagent.start": this.timeline({ kind: "subagent.start", title: `subagent: ${e.title}`, status: "running" }); this.push(); break;
      case "subagent.done": this.timeline({ kind: "subagent.done", title: "subagent finished", status: e.ok ? "ok" : "error" }); this.push(); break;
      case "turn.done": this.timeline({ kind: "turn.done", title: `turn ${e.outcome.status}`, detail: e.outcome.errorMessage, status: e.outcome.status === "done" ? "ok" : e.outcome.status === "cancelled" ? "cancelled" : "error" }); this.push(); break;
      default: break;
    }
  }

  private onNotice(n: Notice): void {
    if (n.kind === "retry") { this.timeline({ kind: "retry", title: `retry ${n.attempt} in ${n.delayMs} ms`, detail: n.reason, status: "running" }); this.notice({ level: "warn", title: "Retrying", message: `${n.reason}. Attempt ${n.attempt + 1}.` }); }
    else if (n.kind === "fallback") { this.timeline({ kind: "fallback", title: `fallback → ${n.to}`, detail: n.reason, status: "ok" }); this.notice({ level: "warn", title: `Switched to fallback model ${n.to}`, message: `${n.from} failed: ${n.reason}. Continuing automatically; the fallback starts a fresh TrueForge session with a summary of progress.` }); }
    else if (n.kind === "failed") this.timeline({ kind: "error", title: n.error.title, detail: n.error.message.slice(0, 160), status: "error" });
  }

  private onToolEvent(e: ForgeEvent): void {
    if (e.type === "context") this.state.context = { used: e.bundle.usedTokens, budget: e.bundle.budgetTokens, items: e.bundle.items.map((i) => ({ path: i.path, tier: i.tier, tokens: i.tokens, reasons: i.reasons })), excluded: e.bundle.excluded.slice(0, 40) };
    else if (e.type === "plan") this.state.plan = e.steps;
    this.push();
  }

  async dispose(): Promise<void> {
    this.abort?.abort();
    await this.srv?.close();
  }
}

export { randomBytes };
