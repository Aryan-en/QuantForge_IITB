/**
 * The shipped webview bundle (dist/webview) driven exactly like VS Code drives it: a fake acquireVsCodeApi,
 * and messages shaped like packages/extension/src/controller.ts sends. Every message the UI sends back must
 * pass the extension's own validator (packages/protocol), or the extension would drop it.
 */
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { WebviewToHost } from "../../../packages/protocol/src/messages";

const ROOT = path.resolve(__dirname, "../..");
const JS = path.join(ROOT, "dist/webview/main.js");
const CSS = path.join(ROOT, "dist/webview/main.css");

test.beforeAll(() => {
  execFileSync(process.execPath, [path.join(ROOT, "webview/build.mjs")], { cwd: ROOT, stdio: "ignore" });
  expect(existsSync(JS) && existsSync(CSS)).toBe(true);
});

type Ext = Record<string, unknown>;
const base: Ext = {
  connection: "ok",
  model: "provider/primary-model",
  fallbacks: ["provider/fallback-model"],
  running: false,
  sessionId: null,
  messages: [],
  stream: "",
  timeline: [],
  plan: [],
  context: null,
  review: null,
  approval: null,
  notice: null,
};
let seq = 0;
const ev = (kind: string, title: string, detail?: string, status = "ok") => ({ id: String(++seq), at: new Date().toISOString(), kind, title, detail, status });

async function mount(page: Page) {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.setContent('<!doctype html><html><head></head><body class="vscode-dark"><div id="root"></div></body></html>');
  // VS Code injects acquireVsCodeApi before the webview's scripts run; do the same.
  await page.evaluate(() => {
    const w = window as unknown as { __sent: unknown[]; acquireVsCodeApi: () => unknown };
    w.__sent = [];
    w.acquireVsCodeApi = () => ({ postMessage: (m: unknown) => w.__sent.push(m), getState: () => undefined, setState: () => undefined });
  });
  await page.addStyleTag({ path: CSS });
  await page.addScriptTag({ path: JS });
}
const host = (page: Page, m: Record<string, unknown>) => page.evaluate((msg) => window.postMessage({ v: 1, id: "h", ...msg }, "*"), m);
const snap = (page: Page, s: Ext) => host(page, { type: "state.snapshot", state: { ...base, ...s } });
const sent = (page: Page) => page.evaluate(() => (window as unknown as { __sent: Record<string, unknown>[] }).__sent);

test("the bundled UI runs a full agent turn against the extension's wire format", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mount(page);
  await snap(page, {});

  // Task submit
  const box = page.getByRole("combobox", { name: "Task for QuantForge" });
  await box.fill("Add a flask config command");
  await box.press("Enter");
  await expect.poll(async () => (await sent(page)).some((m) => m.type === "task.submit")).toBe(true);

  // Running: user message, streamed text, a tool call with a readable summary
  const user = { role: "user", text: "Add a flask config command" };
  const t1 = [ev("session.start", "agent task", "provider/primary-model", "running")];
  await snap(page, { running: true, sessionId: "ses_1", messages: [user], timeline: t1 });
  await host(page, { type: "stream.delta", turnId: "1", threadId: "main", text: "Looking for where CLI commands live." });
  await expect(page.getByText("Looking for where CLI commands live.")).toBeVisible();
  const t2 = [...t1, ev("tool.call", "search_workspace", '{"query":"click.command","maxResults":50}', "running")];
  await snap(page, { running: true, sessionId: "ses_1", messages: [user, { role: "assistant", text: "Looking for where CLI commands live." }], timeline: t2 });
  await expect(page.getByRole("button", { name: "search_workspace click.command" })).toBeVisible();
  const t3 = [...t2, ev("tool.result", "search_workspace", "9 matches in 3 files")];
  const msgs = [user, { role: "assistant", text: "Looking for where CLI commands live." }];
  const context = { used: 9100, budget: 24000, items: [{ path: "src/flask/cli.py", tier: "full", tokens: 6200, reasons: ["defines routes_command"] }, { path: "tests/test_cli.py", tier: "symbols", tokens: 2900, reasons: ["tests cli.py"] }], excluded: [{ path: "uv.lock", reason: "lockfile" }] };
  const plan = [{ id: "1", title: "Find CLI commands", status: "done" }, { id: "2", title: "Add config command", status: "in_progress" }];
  await snap(page, { running: true, sessionId: "ses_1", messages: msgs, timeline: t3, context, plan });

  // Terminal approval → Allow
  const approvalT = { callId: "call_t", tool: "run_terminal", detail: "pytest tests/test_cli.py -q\n— verify the change\n(runs in a disposable copy that includes the proposed edits)" };
  await snap(page, { running: true, sessionId: "ses_1", messages: msgs, timeline: t3, context, plan, approval: approvalT });
  await expect(page.getByText("pytest tests/test_cli.py -q")).toBeVisible();
  await page.getByRole("button", { name: "Allow" }).click();
  await expect.poll(async () => (await sent(page)).find((m) => m.type === "approval.decide")).toMatchObject({ callId: "call_t", decision: "allow" });

  // Review gate: per-hunk decisions, then Apply = TrueForge approval
  const hunk = (id: string, state: string) => ({ id, header: "@@ -10,3 +10,4 @@", lines: [{ kind: "context", text: "a" }, { kind: "add", text: "b" }], state });
  const review = (s1: string, s2: string, awaiting = true) => ({
    batchId: "b1",
    awaitingApproval: awaiting,
    canUndo: false,
    proposals: [
      { id: "p1", path: "src/flask/cli.py", kind: "modify", rationale: "Add the command", linesAdded: 1, linesRemoved: 0, hunks: [hunk("h1", s1)] },
      { id: "p2", path: "docs/cli.rst", kind: "modify", rationale: "Document it", linesAdded: 1, linesRemoved: 0, hunks: [hunk("h2", s2)] },
    ],
  });
  const gate = { callId: "call_g", tool: "submit_changes", detail: "Add flask config\n2 file(s) proposed. Review each hunk, then apply." };
  const t4 = [...t3, ev("approval.decided", "run_terminal: allow")];
  await snap(page, { running: true, sessionId: "ses_1", messages: msgs, timeline: t4, context, plan, approval: gate, review: review("pending", "pending") });
  await expect(page.getByRole("tab", { name: /Review/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Accept", exact: true }).first().click();
  await page.getByRole("button", { name: "Reject", exact: true }).last().click();
  await snap(page, { running: true, sessionId: "ses_1", messages: msgs, timeline: t4, context, plan, approval: gate, review: review("accepted", "rejected") });
  await page.getByRole("button", { name: /Apply 1 accepted/ }).click();
  await expect.poll(async () => (await sent(page)).filter((m) => m.type === "approval.decide").at(-1)).toMatchObject({ callId: "call_g", decision: "allow" });

  // Applied: undo is offered and sends the extension's undo
  await snap(page, { running: false, sessionId: "ses_1", messages: msgs, timeline: [...t4, ev("turn.done", "turn done")], context, plan, review: { batchId: "b1", awaitingApproval: false, canUndo: true, proposals: [] } });
  await page.getByRole("button", { name: "Undo last batch" }).click();
  await expect.poll(async () => (await sent(page)).some((m) => m.type === "review.bulk" && m.action === "undo")).toBe(true);

  // Context and plan reached their tabs
  await page.getByRole("tab", { name: /Context/ }).click();
  await expect(page.getByText("defines routes_command")).toBeVisible();
  await expect(page.getByText("lockfile")).toBeVisible();

  // Every message the UI sent is valid for the extension
  const all = await sent(page);
  const invalid = all.map((m) => ({ m, r: WebviewToHost.safeParse(m) })).filter((x) => !x.r.success).map((x) => `${String(x.m.type)}: ${x.r.error?.issues[0]?.message}`);
  expect(invalid).toEqual([]);
  expect(errors).toEqual([]);
});

test("cancel, retry, fallback and errors map to the right UI and messages", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mount(page);
  await snap(page, {});
  const user = { role: "user", text: "Fix get_debug_flag" };

  // Retry then fallback, no user action
  const t1 = [ev("session.start", "inline task", "p/primary → p/fallback", "running"), ev("retry", "retry 1 in 900 ms", "Model rate limited", "running")];
  await snap(page, { running: true, sessionId: "ses_2", messages: [user], timeline: t1 });
  await expect(page.getByText(/Retry 1\/3/)).toBeVisible();
  const t2 = [...t1, ev("fallback", "fallback → provider/fallback-model", "Model unavailable")];
  await snap(page, { running: true, sessionId: "ses_2", messages: [user], timeline: t2, notice: { level: "warn", title: "Switched to fallback model provider/fallback-model", message: "…" } });
  await expect(page.getByText("Switched to fallback model automatically.")).toBeVisible();

  // Stop → the extension's cancel with the session id
  await page.getByRole("button", { name: /Stop/ }).click();
  await expect.poll(async () => (await sent(page)).find((m) => m.type === "turn.cancel")).toMatchObject({ sessionId: "ses_2" });
  await snap(page, { running: false, sessionId: "ses_2", messages: [user], timeline: t2, notice: { level: "info", title: "Cancelled", message: "Nothing was written to your files." } });
  await expect(page.getByText("Cancelled — nothing was written to your files.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send (Enter)" })).toBeVisible();

  // Unreachable TrueForge: clear message, action runs the extension command
  await snap(page, {
    connection: "down",
    sessionId: "ses_2",
    messages: [user],
    timeline: t2,
    notice: { level: "error", title: "TrueForge is not reachable", message: "connect ECONNREFUSED. Start it with “QuantForge: Start TrueForge”.", action: { label: "Start TrueForge", command: "forge.startTrueForge" } },
  });
  await expect(page.getByText("TrueForge is not reachable")).toBeVisible();
  await page.getByRole("button", { name: "Start TrueForge" }).first().click();
  await expect.poll(async () => (await sent(page)).find((m) => m.type === "command.run")).toMatchObject({ command: "forge.startTrueForge" });

  // Model error after a failed run says the workspace is unchanged
  await snap(page, { sessionId: "ses_2", messages: [user], timeline: t2, notice: { level: "error", title: "Model authentication failed", message: "401 invalid key. Your files were not changed." } });
  await expect(page.getByText("Workspace unchanged")).toBeVisible();

  const all = await sent(page);
  const invalid = all.map((m) => ({ m, r: WebviewToHost.safeParse(m) })).filter((x) => !x.r.success).map((x) => `${String(x.m.type)}: ${x.r.error?.issues[0]?.message}`);
  expect(invalid).toEqual([]);
  expect(errors).toEqual([]);
});
