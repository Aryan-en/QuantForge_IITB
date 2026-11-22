import * as vscode from "vscode";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { promises as fsp } from "node:fs";
import { getLastParserError, parseFile, parseMentions, SqliteSymbolIndex, suggestMentions } from "@forge/context-engine";
import { createToolContext, limitsForContext, startForgeMcpHttp, type ForgeEvent, type RunningServer, type ToolContext } from "@forge/editor-mcp";
import { loadAgent, runResilient, runTurn, TrueForgeApi, type AgentSpec, type ApprovalDecision, type ForgeStreamEvent, type Notice, type ToolCallInfo } from "@forge/trueforge-client";
import { parseWebviewMessage, type PlanStep, type ReviewQueueState, type TimelineEvent, type UserFacingError, type WebviewToHost } from "@forge/protocol";
import { VsCodeFileStore } from "./vscodeStore.js";
import { openDiff, ReviewLensProvider } from "./reviewUi.js";

interface Notice2 { level: "error" | "warn" | "info"; title: string; message: string; action?: { label: string; command: string } }
interface AppState {
  connection: "unknown" | "ok" | "down";
  model: string;
  fallbacks: string[];
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

interface Persisted { v: 1; sessionId: string | null; turnId: string | null; status: "running" | "done" | "cancelled" | "error" | "idle"; mode: "agent" | "inline"; messages: { role: "user" | "assistant"; text: string }[]; plan: PlanStep[]; queue: unknown }

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
  readonly state: AppState = { connection: "unknown", model: "", fallbacks: [], running: false, sessionId: null, messages: [], stream: "", timeline: [], plan: [], context: null, review: null, approval: null, notice: null };
  private inlineMode = false;
  private symbolDb: SqliteSymbolIndex | null = null;
  private watcher: vscode.FileSystemWatcher | null = null;
  private deltaBuf = "";
  private deltaTimer: NodeJS.Timeout | null = null;
  private bypassGateOnce = false;
  private detach = new AbortController();
  private disposed = false;
  private storageFile = "";
  private rec: Persisted = { v: 1, sessionId: null, turnId: null, status: "idle", mode: "agent", messages: [], plan: [], queue: null };

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
    // Self-check: parsing degrades to "no symbols" instead of throwing, so verify it works in THIS runtime and say so if not.
    const probe = await parseFile("probe.py", "def f():\n    pass\n", { size: 1, mtimeMs: 1 });
    if (probe.symbols.length === 0) {
      this.log(`symbol analysis unavailable: ${getLastParserError() ?? "unknown"}`);
      this.state.notice = { level: "warn", title: "Symbol analysis unavailable", message: "Code search still works, but symbol-aware ranking and find_symbol are degraded. See the FORGE output channel." };
    }
    // Optional persistent symbol index (SQLite FTS5 via node:sqlite) with incremental updates from a file watcher.
    if (cfg("index.persistent", true)) {
      this.symbolDb = SqliteSymbolIndex.open(path.join(storage, "symbols.sqlite"));
      this.tool.index.attachStore(this.symbolDb);
      this.log(this.symbolDb ? `persistent symbol index ready (${JSON.stringify(this.symbolDb.stats())})` : "persistent symbol index unavailable (node:sqlite/FTS5 missing); using on-demand parsing");
      const rel = (u: vscode.Uri): string => vscode.workspace.asRelativePath(u, false);
      this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, "**/*"));
      const touch = (u: vscode.Uri): void => { this.tool.ws.invalidate(); this.tool.index.invalidate(rel(u)); };
      this.watcher.onDidChange(touch); this.watcher.onDidCreate(touch);
      this.watcher.onDidDelete((u) => { this.tool.ws.invalidate(); this.tool.index.remove(rel(u)); });
      void this.tool.index.warm().then((n) => this.log(`indexed ${n} source files`)).catch(() => undefined);
    }
    this.storageFile = path.join(storage, "session.json");
    await this.recoverAfterRestart();
    this.api = new TrueForgeApi(cfg("trueforge.baseUrl", "http://localhost:8790"));
    // Stable endpoint per workspace (persisted port + token, owner-only file) so a TrueForge turn that outlives this window can still reach us after a restart.
    const mcpFile = path.join(storage, "mcp.json");
    let saved: { port?: number; token?: string } = {};
    try { saved = JSON.parse(await fsp.readFile(mcpFile, "utf8")) as typeof saved; } catch { /* first run */ }
    const token = saved.token ?? randomBytes(24).toString("hex");
    try { this.srv = await startForgeMcpHttp(this.tool, { port: saved.port ?? 0, token }); }
    catch { this.srv = await startForgeMcpHttp(this.tool, { port: 0, token }); } // saved port taken by another process
    await fsp.mkdir(storage, { recursive: true });
    await fsp.writeFile(mcpFile, JSON.stringify({ port: this.srv.port, token }), { mode: 0o600 });
    this.log(`MCP server listening on ${this.srv.url}`);
    await this.checkConnection();
  }

  // ------------------------------------------------------------------ persistence / recovery
  private async persist(patch: Partial<Persisted> = {}): Promise<void> {
    if (!this.storageFile) return;
    Object.assign(this.rec, patch, { messages: this.state.messages.slice(-50), plan: this.state.plan, queue: this.tool.review.snapshot() });
    try {
      await fsp.mkdir(path.dirname(this.storageFile), { recursive: true });
      await fsp.writeFile(this.storageFile + ".tmp", JSON.stringify(this.rec), "utf8");
      await fsp.rename(this.storageFile + ".tmp", this.storageFile);
    } catch (e) { this.log(`persist failed: ${String(e)}`); }
  }

  /** On startup: finish any half-applied batch (crash recovery), restore the review queue and offer to resume a running turn. */
  private async recoverAfterRestart(): Promise<void> {
    const rep = await this.tool.review.reconcile();
    if (rep.committed.length || rep.partial.length || rep.rolledBack.length) {
      this.log(`journal reconcile: ${JSON.stringify(rep)}`);
      if (rep.partial.length) void vscode.window.showWarningMessage(`FORGE was interrupted while applying changes. ${rep.partial.map((p) => `${p.applied.length} file(s) were written (undoable), ${p.untouched.length} untouched`).join("; ")}.`);
      else if (rep.committed.length) void vscode.window.showInformationMessage("FORGE recovered an interrupted apply: the changes were written and can be undone.");
    }
    try {
      const saved = JSON.parse(await fsp.readFile(this.storageFile, "utf8")) as Persisted;
      if (saved?.v !== 1) return;
      this.rec = saved;
      this.state.messages = saved.messages ?? [];
      this.state.plan = saved.plan ?? [];
      this.state.sessionId = saved.sessionId;
      if (saved.queue) await this.tool.review.restore(saved.queue as never);
      this.tool.review.clearSettled();
      if (saved.status === "running" && saved.sessionId && saved.turnId) {
        void vscode.window.showInformationMessage("FORGE was working on a task when the window closed.", "Resume", "Discard").then(async (pick) => {
          if (pick === "Resume") await this.resumeTask();
          else if (pick === "Discard") { this.tool.review.discardAll(); await this.persist({ status: "idle", turnId: null }); this.push(); }
        });
      }
    } catch { /* first run or unreadable: start clean */ }
  }

  /** Re-attach to the TrueForge turn that was running before the reload; unanswered approvals are asked again. */
  async resumeTask(): Promise<void> {
    if (!this.rec.sessionId || !this.rec.turnId || this.state.running) return;
    await this.checkConnection();
    if (this.state.connection !== "ok") return;
    this.inlineMode = this.rec.mode === "inline";
    this.bypassGateOnce = true; // the approval being resumed was already past the gate (or deliberately let through) before the reload
    this.abort = new AbortController();
    Object.assign(this.state, { running: true, stream: "", notice: null });
    void vscode.commands.executeCommand("setContext", "forge.running", true);
    this.timeline({ kind: "session.start", title: "resumed after reload", status: "running" });
    this.push();
    try {
      const out = await runTurn(this.api.sdk, { sessionId: this.rec.sessionId, text: "", resume: { turnId: this.rec.turnId }, signal: this.abort.signal, detach: this.detach.signal, stallTimeoutMs: cfg("stallTimeoutMs", 45000), onEvent: (e) => this.onStream(e), onApproval: (c) => this.approvalFor(c) });
      if (out.status === "error") this.notice({ level: "error", title: "The resumed run failed", message: `${out.errorMessage ?? ""} Your files were not changed.` });
      else if (out.status === "cancelled") this.notice({ level: "info", title: "Cancelled", message: "Nothing was written to your files." });
      if (this.state.stream) { this.state.messages.push({ role: "assistant", text: this.state.stream }); this.state.stream = ""; }
      if (this.disposed) return;
      await this.persist({ status: out.status === "done" ? "done" : out.status });
    } catch (e) {
      this.notice({ level: "error", title: "Could not resume", message: String(e) });
    } finally {
      this.abort = null; this.pending = null; this.state.approval = null; this.inlineMode = false; this.state.running = false;
      void vscode.commands.executeCommand("setContext", "forge.running", false);
      this.push();
    }
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
    this.state.fallbacks = cfg<string[]>("model.fallbacks", []);
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
        void this.persist(); this.push(); break;
      }
      case "review.bulk": await this.bulk(m.action); break;
      case "review.openDiff": { const root = this.root(); if (root) await openDiff(this.tool.review, m.proposalId, root); break; }
      case "mention.query": {
        if (!this.tool) break;
        const items = await suggestMentions(this.tool.ws, this.tool.index, m.query, 10).catch(() => []);
        this.post({ type: "mention.results", query: m.query, items: items.map((i) => ({ kind: i.kind, label: i.label, insert: i.insert, ...(i.detail ? { detail: i.detail } : {}) })) });
        break;
      }
      case "file.open": await this.openFile(m.path, m.line); break;
      case "command.run": await vscode.commands.executeCommand(m.command); break;
      case "settings.update": break; // settings live in VS Code settings (forge.*); the sidebar has no editable fields yet
    }
  }

  /** Open a workspace file from the sidebar (Context rows, plan chips). Paths outside the workspace are ignored. */
  private async openFile(rel: string, line?: number): Promise<void> {
    const root = this.root();
    if (!root) return;
    const target = vscode.Uri.joinPath(root, rel);
    const inside = path.relative(root.fsPath, target.fsPath);
    if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) { this.log(`file.open refused (outside workspace): ${rel}`); return; }
    try {
      const doc = await vscode.workspace.openTextDocument(target);
      const pos = new vscode.Position(Math.max(0, (line ?? 1) - 1), 0);
      await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos), preview: true });
    } catch (e) { this.log(`file.open failed for ${rel}: ${String(e)}`); }
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
    void this.persist();
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
    if (call.tool === "submit_changes") {
      // Completeness gate: send a model back BEFORE asking the human if it has not shown every requirement is covered.
      const g: ReturnType<typeof this.tool.review.submitGate> = this.bypassGateOnce ? { pass: true } : this.tool.review.submitGate();
      this.bypassGateOnce = false;
      if (!g.pass) {
        this.timeline({ kind: "approval.decided", title: "submit_changes declined: run verify_changes first", detail: "the agent must map every requirement to a line it added", status: "error" });
        this.push();
        return Promise.resolve({ status: "deny", reason: g.reason });
      }
      if (g.unverified) this.timeline({ kind: "approval.requested", title: "submitted without a passing verify_changes", detail: "shown to you for review anyway", status: "running" });
    }
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
    // Render the proposal in the editor itself: native side-by-side diff (left pane is the real file, so the per-hunk CodeLens is there too).
    if (first && root) await openDiff(this.tool.review, first.id, root);
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
    // Size tool output to the SMALLEST context window among the models that may run this task (a fallback may take over).
    try {
      const info = await this.api.listModels();
      const ctxLens = models.map((m) => info.find((i) => i.name === m)?.contextLength).filter((n): n is number => typeof n === "number" && n > 0);
      this.tool.limits = limitsForContext(ctxLens.length ? Math.min(...ctxLens) : undefined);
      this.log(`tool output limits: ${JSON.stringify(this.tool.limits)} (model contexts: ${ctxLens.join(", ") || "unknown"})`);
    } catch { /* keep previous limits */ }

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
        text: prompt, models, specFor: (m) => specs.get(m)!, signal: this.abort.signal, detach: this.detach.signal, stallTimeoutMs: cfg("stallTimeoutMs", 45000),
        onEvent: (e) => this.onStream(e), onNotice: (n) => this.onNotice(n), onApproval: (c) => this.approvalFor(c),
        describeProgress: () => { const q = this.tool.review.list(); return q.length ? `Edits already proposed (still queued): ${q.map((p) => p.path).join(", ")}. Do not re-propose them.` : "No edits were queued yet."; },
      });
      this.state.sessionId = res.sessionId;
      if (this.disposed) return;
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
      if (!this.disposed) void this.persist({ status: this.state.notice?.level === "error" ? "error" : "done" });
      void vscode.commands.executeCommand("setContext", "forge.running", false);
      // Safety net: a model may skip submit_changes. Leftover proposals still go through human review.
      const left = this.tool.review.list().filter((p) => [...p.states.values()].some((s) => s === "pending" || s === "accepted"));
      if (left.length && !this.state.notice) this.notice({ level: "info", title: "Changes are waiting for your review", message: `${left.length} file(s) proposed but not applied. Open the Review tab to accept or reject each hunk.` });
      this.push();
    }
  }

  private onStream(e: ForgeStreamEvent): void {
    if (e.type !== "text.delta") this.flushDelta();
    switch (e.type) {
      case "turn.started": this.state.sessionId = e.sessionId; void this.persist({ sessionId: e.sessionId, turnId: e.turnId, status: "running", mode: this.inlineMode ? "inline" : "agent" }); break;
      case "text.delta": if (e.threadId === "main") { this.state.stream += e.text; this.queueDelta(e.text); } break;
      case "message.complete": if (e.threadId === "main" && this.state.stream && !e.text) { /* tool-call-only message */ } break;
      case "tool.call": this.timeline({ kind: "tool.call", title: e.call.tool, detail: e.call.args.slice(0, 120), status: "running" }); if (this.state.stream) { this.state.messages.push({ role: "assistant", text: this.state.stream }); this.state.stream = ""; } this.push(); break;
      case "tool.result": this.timeline({ kind: "tool.result", title: e.tool ?? "tool", detail: e.preview.slice(0, 120), status: e.ok ? "ok" : "error" }); this.push(); break;
      case "subagent.start": this.timeline({ kind: "subagent.start", title: `subagent: ${e.title}`, status: "running" }); this.push(); break;
      case "subagent.done": this.timeline({ kind: "subagent.done", title: "subagent finished", status: e.ok ? "ok" : "error" }); this.push(); break;
      case "turn.done": this.timeline({ kind: "turn.done", title: `turn ${e.outcome.status}`, detail: e.outcome.errorMessage, status: e.outcome.status === "done" ? "ok" : e.outcome.status === "cancelled" ? "cancelled" : "error" }); this.push(); break;
      default: break;
    }
  }

  /** Coalesce token deltas into ~one message per frame so a fast stream cannot flood the webview. */
  private queueDelta(text: string): void {
    this.deltaBuf += text;
    this.deltaTimer ??= setTimeout(() => this.flushDelta(), 16);
  }
  private flushDelta(): void {
    if (this.deltaTimer) clearTimeout(this.deltaTimer);
    this.deltaTimer = null;
    if (!this.deltaBuf) return;
    const text = this.deltaBuf;
    this.deltaBuf = "";
    this.post({ type: "stream.delta", turnId: String(this.seq), threadId: "main", text });
  }

  private onNotice(n: Notice): void {
    if (n.kind === "retry") { this.timeline({ kind: "retry", title: `retry ${n.attempt} in ${n.delayMs} ms`, detail: n.reason, status: "running" }); this.notice({ level: "warn", title: "Retrying", message: `${n.reason}. Attempt ${n.attempt + 1}.` }); }
    else if (n.kind === "fallback") { this.timeline({ kind: "fallback", title: `fallback → ${n.to}`, detail: n.reason, status: "ok" }); this.notice({ level: "warn", title: `Switched to fallback model ${n.to}`, message: `${n.from} failed: ${n.reason}. Continuing automatically; the fallback starts a fresh TrueForge session with a summary of progress.` }); }
    else if (n.kind === "failed") this.timeline({ kind: "error", title: n.error.title, detail: n.error.message.slice(0, 160), status: "error" });
  }

  private onToolEvent(e: ForgeEvent): void {
    if (e.type === "proposal") void this.persist();
    if (e.type === "timeline" && e.event.title === "verify_changes" && e.event.status === "ok") void this.persist(); // keep the 'verified' flag across a reload
    if (e.type === "context") this.state.context = { used: e.bundle.usedTokens, budget: e.bundle.budgetTokens, items: e.bundle.items.map((i) => ({ path: i.path, tier: i.tier, tokens: i.tokens, reasons: i.reasons })), excluded: e.bundle.excluded.slice(0, 40) };
    else if (e.type === "plan") this.state.plan = e.steps;
    this.push();
  }

  async dispose(): Promise<void> {
    // Window closing / reloading: detach from the TrueForge turn but do NOT cancel it, so it can be resumed.
    this.disposed = true;
    this.detach.abort();
    this.watcher?.dispose();
    this.flushDelta();
    await this.srv?.close();
    try { this.symbolDb?.close(); } catch { /* already closed */ }
  }
}

export { randomBytes };
