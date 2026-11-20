import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { renderHtml } from "../src/webviewHtml.js";
import { parseWebviewMessage } from "@forge/protocol";

function mount() {
  const html = renderHtml({ cspSource: "vscode-resource:" } as never, "NONCE123");
  const sent: any[] = [];
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, beforeParse(w: any) { w.acquireVsCodeApi = () => ({ postMessage: (m: unknown) => void sent.push(m) }); } });
  const w = dom.window as any;
  const push = (state: object) => w.dispatchEvent(new w.MessageEvent("message", { data: { type: "state.snapshot", state } }));
  const q = (s: string) => w.document.querySelector(s) as HTMLElement | null;
  const qa = (s: string) => [...w.document.querySelectorAll(s)] as HTMLElement[];
  const click = (el: Element | null) => (el as HTMLElement).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  return { w, sent, push, q, qa, click, html };
}
const base = { connection: "ok", model: "p/m", fallbacks: [], running: false, messages: [], timeline: [], plan: [], context: null, review: null, approval: null, notice: null, stream: "" };

describe("sidebar UI (real HTML + script, fake VS Code API)", () => {
  it("has a strict CSP with a nonce and no remote content", () => {
    const { html } = mount();
    expect(html).toMatch(/Content-Security-Policy[^>]*default-src 'none'/);
    expect(html).toContain("nonce=\"NONCE123\"");
    expect(html).not.toMatch(/https?:\/\//);
  });
  it("tells the host it is ready and every message it ever sends passes the host's zod contract", () => {
    const m = mount();
    m.push({ ...base, review: { batchId: "b", canUndo: true, awaitingApproval: true, proposals: [{ id: "p1", path: "a.py", kind: "modify", rationale: "r", linesAdded: 1, linesRemoved: 1, hunks: [{ id: "h1", header: "@@", state: "pending", lines: [{ kind: "del", text: "x" }, { kind: "add", text: "y" }] }] }] }, approval: { callId: "c1", tool: "submit_changes", detail: "d" } });
    m.click(m.q('[data-ap="allow"]'));
    m.click(m.q('[data-ap="deny"]'));
    m.qa("nav button").find((b) => b.dataset.t === "review") && m.click(m.qa("nav button").find((b) => b.dataset.t === "review")!);
    for (const sel of ['[data-h$="|accept"]', '[data-h$="|reject"]', '[data-a="acceptAll"]', '[data-a="rejectAll"]', '[data-a="apply"]', '[data-a="undo"]', "[data-diff]"]) m.click(m.q(sel));
    (m.q("#in") as HTMLTextAreaElement).value = "do the thing @helpers.py";
    m.click(m.q("#send"));
    expect(m.sent[0]).toMatchObject({ type: "ready" });
    const types = m.sent.map((s) => s.type);
    expect(types).toEqual(expect.arrayContaining(["ready", "approval.decide", "review.hunk", "review.bulk", "review.openDiff", "task.submit"]));
    for (const msg of m.sent) expect(parseWebviewMessage(msg), JSON.stringify(msg)).toMatchObject({ ok: true });
  });
  it("shows the welcome/onboarding card until TrueForge is connected and a model is set", () => {
    const m = mount();
    m.push({ ...base, connection: "down", model: "" });
    expect(m.q("#welcome")?.textContent).toMatch(/Start TrueForge/);
    expect(m.q("#welcome")?.textContent).toMatch(/Model: none selected/);
    m.click(m.q('[data-cmd="forge.startTrueForge"]'));
    expect(m.sent.at(-1)).toMatchObject({ type: "command.run", command: "forge.startTrueForge" });
    m.push({ ...base });
    expect(m.q("#welcome")).toBeNull();
  });
  it("renders approvals as an alert dialog with the literal command and routes decisions by call id", () => {
    const m = mount();
    m.push({ ...base, approval: { callId: "call_9", tool: "run_terminal", detail: "pytest tests/test_cli.py -q\n— verify" } });
    const card = m.q('[role="alertdialog"]')!;
    expect(card.textContent).toContain("pytest tests/test_cli.py -q");
    m.click(m.q('[data-ap="allow"]'));
    expect(m.sent.at(-1)).toMatchObject({ type: "approval.decide", callId: "call_9", decision: "allow" });
  });
  it("escapes model/tool/file text (no HTML injection from untrusted content)", () => {
    const m = mount();
    m.push({ ...base, messages: [{ role: "assistant", text: '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>' }], notice: { level: "error", title: "<b>t</b>", message: "<i>m</i>" }, stream: "<u>live</u>" });
    expect(m.qa("main img, main script, #banner b, #banner i, main u")).toHaveLength(0);
    expect((m.w as any).__pwned).toBeUndefined();
    expect(m.q("main")!.textContent).toContain("<img src=x");
  });
  it("@ picker: typing queries the host (debounced); arrows + Enter insert the suggestion; Escape closes", async () => {
    const m = mount();
    const ta = m.q("#in") as HTMLTextAreaElement;
    ta.value = "fix @hel";
    ta.setSelectionRange(8, 8);
    ta.dispatchEvent(new m.w.Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    expect(m.sent.at(-1)).toMatchObject({ type: "mention.query", query: "hel" });
    m.w.dispatchEvent(new m.w.MessageEvent("message", { data: { type: "mention.results", query: "hel", items: [{ kind: "file", label: "src/a/helpers.py", insert: "src/a/helpers.py" }, { kind: "symbol", label: "help_me", insert: "symbol:help_me@src/b.py", detail: "function" }] } }));
    expect(m.qa('#pick [role="option"]')).toHaveLength(2);
    ta.dispatchEvent(new m.w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    ta.dispatchEvent(new m.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(ta.value).toBe("fix @symbol:help_me@src/b.py ");
    expect(m.q("#pick")!.hidden).toBe(true);
  });
  it("streams text, shows Stop only while running, and Esc in the composer cancels", () => {
    const m = mount();
    m.push({ ...base, running: true, sessionId: "s1" });
    expect(m.q("#stop")!.hidden).toBe(false);
    expect((m.q("#send") as HTMLButtonElement).disabled).toBe(true);
    m.w.dispatchEvent(new m.w.MessageEvent("message", { data: { type: "stream.delta", text: "Hello " } }));
    m.w.dispatchEvent(new m.w.MessageEvent("message", { data: { type: "stream.delta", text: "world" } }));
    expect(m.q("main")!.textContent).toContain("Hello world");
    (m.q("#in") as HTMLElement).dispatchEvent(new m.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(m.sent.at(-1)).toMatchObject({ type: "turn.cancel", sessionId: "s1" });
    expect(parseWebviewMessage(m.sent.at(-1))).toMatchObject({ ok: true });
  });
  it("basic accessibility: labelled composer, tab roles, alert banner, every button has a name", () => {
    const m = mount();
    m.push({ ...base, notice: { level: "error", title: "Down", message: "x" }, review: { batchId: "", canUndo: false, awaitingApproval: false, proposals: [] } });
    expect(m.q("#in")!.getAttribute("aria-label")).toBeTruthy();
    expect(m.qa('nav [role="tab"]').length).toBe(5);
    expect(m.qa('nav [role="tab"][aria-selected="true"]').length).toBe(1);
    expect(m.q('#banner [role="alert"]')).not.toBeNull();
    for (const b of m.qa("button")) expect((b.textContent ?? "").trim().length + (b.getAttribute("aria-label") ?? "").length, b.outerHTML).toBeGreaterThan(0);
  });
});
