// Runs INSIDE a real VS Code extension host (launched by run.live.ts). Plain CJS: loaded directly by VS Code.
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

exports.run = async () => {
  const out = process.env.FORGE_TEST_OUT;
  const ws = process.env.FORGE_TEST_WS;
  const steps = [];
  const ok = (name, pass, detail) => steps.push({ name, pass: !!pass, detail: detail === undefined ? undefined : String(detail).slice(0, 300) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const scenario = process.env.FORGE_TEST_SCENARIO || "taskA";
  // Extension-host responsiveness: a 25 ms ticker; the largest gap between ticks shows whether the host ever blocked.
  let last = Date.now(), maxGap = 0;
  const lagTimer = setInterval(() => { const now = Date.now(); maxGap = Math.max(maxGap, now - last - 25); last = now; }, 25);
  try {
    const ext = vscode.extensions.getExtension("forge-dev.forge");
    ok("extension found at " + (ext && ext.extensionPath), !!ext);
    const api = await ext.activate();
    const c = api.controller;
    ok("activated", ext.isActive);
    const cmds = await vscode.commands.getCommands(true);
    ok("commands registered", ["forge.inlineEdit", "forge.openAgent", "forge.cancel", "forge.startTrueForge", "forge.review.undo", "forge.hunk.accept"].every((x) => cmds.includes(x)));
    ok("workspace trust bypassed for test", vscode.workspace.isTrusted);

    const cfg = vscode.workspace.getConfiguration("forge");
    await cfg.update("trueforge.baseUrl", process.env.FORGE_TF_URL, vscode.ConfigurationTarget.Global);
    await cfg.update("model.primary", process.env.FORGE_TEST_MODEL, vscode.ConfigurationTarget.Global);
    if (process.env.FORGE_TEST_FALLBACK) await cfg.update("model.fallbacks", [process.env.FORGE_TEST_FALLBACK], vscode.ConfigurationTarget.Global);
    await c.checkConnection();
    ok("connected to TrueForge and registered MCP tools", c.state.connection === "ok", c.state.notice && c.state.notice.message);

    ok("Tree-sitter works inside the bundled extension (no degraded-symbols warning)", !(c.state.notice && /Symbol analysis unavailable/.test(c.state.notice.title)), c.state.notice && c.state.notice.title);
    // The sidebar protocol, exercised through the real controller with a stand-in webview.
    {
      const got = []; let handler = null;
      c.attach({ postMessage: (m) => { got.push(m); return Promise.resolve(true); }, onDidReceiveMessage: (cb) => { handler = cb; return { dispose() {} }; } });
      const wait = async (pred) => { for (let i = 0; i < 60 && !got.some(pred); i++) await sleep(100); return got.find(pred); };
      handler({ v: 1, id: "1", type: "ready" });
      ok("sidebar receives a state snapshot on ready", !!(await wait((m) => m.type === "state.snapshot")));
      handler({ v: 1, id: "2", type: "mention.query", query: "helpers" });
      const r = await wait((m) => m.type === "mention.results" && m.query === "helpers");
      ok("@ picker: file suggestions from the real workspace", r && r.items.some((i) => i.kind === "file" && i.insert === "src/flask/helpers.py"), r && JSON.stringify(r.items.slice(0, 2)));
      handler({ v: 1, id: "3", type: "mention.query", query: "symbol:get_debug_fl" });
      const r2 = await wait((m) => m.type === "mention.results" && m.query === "symbol:get_debug_fl");
      ok("@ picker: symbol suggestions via Tree-sitter inside the bundled extension", r2 && r2.items[0] && r2.items[0].insert === "symbol:get_debug_flag@src/flask/helpers.py", r2 && JSON.stringify(r2.items.slice(0, 1)));
      const n0 = got.length;
      handler({ v: 1, id: "4", type: "task.submit", text: "x", mentions: [], rogue: true });
      handler({ v: 1, id: "5", type: "command.run", command: "workbench.action.closeAllEditors" });
      await sleep(300);
      ok("invalid / non-forge messages are dropped, not executed", c.state.running === false && got.length === n0);
    }
    const file = path.join(ws, "src/flask/helpers.py");
    const before = fs.readFileSync(file, "utf8");
    const doc = await vscode.workspace.openTextDocument(file);
    const ed = await vscode.window.showTextDocument(doc);
    ed.selection = new vscode.Selection(27, 0, 32, 70);
    const header = `File: src/flask/helpers.py\nSelected lines: 28-33\n<<<SELECTION\n${doc.getText(ed.selection)}\nSELECTION>>>\n\nInstruction: `;

    const mid = { handled: false };
    const timer = setInterval(async () => {
      if (scenario.startsWith("resume")) return; // resume scenarios drive approvals themselves
      const a = c.state.approval;
      if (!a || mid.handled || a.tool !== "submit_changes") return;
      mid.handled = true;
      // What the developer would see while the turn is paused on the Review Gate:
      mid.diskUnchanged = fs.readFileSync(file, "utf8") === before;
      mid.bufferUnchanged = doc.getText() === before;
      mid.queued = c.review.list().map((p) => `${p.path}:${p.hunks.length}`);
      const lenses = (await vscode.commands.executeCommand("vscode.executeCodeLensProvider", doc.uri)) || [];
      mid.lensTitles = lenses.map((l) => l.command && l.command.title).filter(Boolean);
      mid.reviewState = c.state.review && c.state.review.proposals.length;
      const p = c.review.list()[0];
      const content = p && (await vscode.workspace.openTextDocument(vscode.Uri.from({ scheme: "forge-proposed", authority: p.id, path: "/" + p.path })));
      mid.proposedViewHasChange = !!content && content.getText().includes('"off", "n"');
      await vscode.commands.executeCommand("forge.hunk.accept", p.id, p.hunks[0].id);
      c.decideApproval(a.callId, "allow");
    }, 150);

    if (scenario === "resume1") {
      // Window 1: start the task, wait until FORGE is paused on the Review Gate with state persisted, then quit VS Code (a "reload").
      void c.runTask("Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.", "inline", header);
      const t0 = Date.now();
      while (!(c.state.approval && c.state.approval.tool === "submit_changes") && Date.now() - t0 < 30000) await sleep(100);
      ok("window 1 paused on the Review Gate", c.state.approval && c.state.approval.tool === "submit_changes");
      await sleep(800); // let the state file flush
      ok("window 1 wrote nothing to disk", fs.readFileSync(file, "utf8") === before);
      fs.writeFileSync(out, JSON.stringify(steps, null, 1));
      await vscode.commands.executeCommand("workbench.action.quit");
      await sleep(10000);
      return;
    }
    if (scenario === "resume2") {
      // Window 2 (same profile + workspace): state restored from disk; resume the SAME TrueForge turn; approve; applied once.
      ok("review queue restored after restart", c.review.list().length === 1, c.review.list().map((p) => p.path).join(","));
      ok("conversation restored after restart", c.state.messages.length >= 1 && c.state.messages[0].role === "user");
      ok("file still untouched before resume", fs.readFileSync(file, "utf8") === before);
      const asked = [];
      const timer2 = setInterval(() => {
        const a = c.state.approval;
        if (!a || asked.includes(a.callId)) return;
        asked.push(a.callId + ":" + a.tool);
        c.review.decideAll("accept");
        c.decideApproval(a.callId, "allow");
      }, 150);
      await c.resumeTask();
      clearInterval(timer2);
      ok("approval re-asked exactly once for the pending Review Gate", asked.length === 1 && asked[0].endsWith(":submit_changes"), JSON.stringify(asked));
      ok("change applied after resume", fs.readFileSync(file, "utf8").includes('{"0", "false", "no", "off", "n"}'));
      ok("no error banner after resume", !c.state.notice || c.state.notice.level !== "error", c.state.notice && c.state.notice.message);
      await vscode.commands.executeCommand("forge.review.undo");
      await sleep(300);
      ok("undo restores byte-identical file", fs.readFileSync(file, "utf8") === before);
      clearInterval(lagTimer);
      fs.writeFileSync(out, JSON.stringify(steps, null, 1));
      if (steps.some((x) => !x.pass)) throw new Error("failed: " + steps.filter((x) => !x.pass).map((x) => x.name).join("; "));
      return;
    }
    if (scenario === "error") {
      const t0 = Date.now();
      await c.runTask("Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.", "inline", header);
      clearInterval(timer);
      clearInterval(lagTimer);
      ok("clear error banner is visible", c.state.notice && c.state.notice.level === "error" && /reach|connect|model/i.test(c.state.notice.title + c.state.notice.message), c.state.notice && c.state.notice.title);
      ok("banner says files were not changed", c.state.notice && /not changed/i.test(c.state.notice.message));
      ok("workspace file byte-identical", fs.readFileSync(file, "utf8") === before);
      ok("no proposals left behind", c.review.list().length === 0);
      ok("agent no longer 'running' (UI not stuck)", c.state.running === false);
      ok("extension host stayed responsive (max event-loop stall < 250 ms)", maxGap < 250, "max stall " + maxGap + " ms; run took " + (Date.now() - t0) + " ms");
      ok("timeline records the failure", c.state.timeline.some((e) => e.kind === "error"));
      fs.writeFileSync(out, JSON.stringify(steps, null, 1));
      if (steps.some((x) => !x.pass)) throw new Error("failed: " + steps.filter((x) => !x.pass).map((x) => x.name).join("; "));
      return;
    }
    await c.runTask("Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.", "inline", header);
    clearInterval(timer);

    ok("paused on review gate with queue intact", mid.handled && mid.queued && mid.queued.length === 1, JSON.stringify(mid.queued));
    ok("real file untouched while awaiting review", mid.diskUnchanged && mid.bufferUnchanged);
    ok("CodeLens Accept/Reject offered for the hunk", mid.lensTitles && mid.lensTitles.includes("Accept") && mid.lensTitles.includes("Reject"), JSON.stringify(mid.lensTitles));
    ok("native diff content provider serves proposed text", mid.proposedViewHasChange);
    ok("sidebar state shows review queue", mid.reviewState === 1);

    const after = fs.readFileSync(file, "utf8");
    ok("change applied to disk after approval", after.includes('{"0", "false", "no", "off", "n"}') && after !== before);
    ok("editor buffer saved (not dirty)", !(await vscode.workspace.openTextDocument(file)).isDirty);
    if (scenario !== "fallback") ok("turn finished without error banner", !c.state.notice || c.state.notice.level !== "error", c.state.notice && c.state.notice.message);

    clearInterval(lagTimer);
    if (scenario === "fallback") {
      ok("automatic fallback happened with no user action", c.state.timeline.some((e) => e.kind === "fallback"), JSON.stringify(c.state.timeline.filter((e) => e.kind === "fallback" || e.kind === "error").map((e) => e.title)));
      ok("extension host stayed responsive (max event-loop stall < 250 ms)", maxGap < 250, "max stall " + maxGap + " ms");
    } else ok("extension host stayed responsive (max event-loop stall < 250 ms)", maxGap < 250, "max stall " + maxGap + " ms");
    await vscode.commands.executeCommand("forge.review.undo");
    await sleep(300);
    ok("undo restores byte-identical file", fs.readFileSync(file, "utf8") === before);
  } catch (e) {
    ok("suite crashed", false, e && e.stack ? e.stack : e);
  }
  fs.writeFileSync(out, JSON.stringify(steps, null, 1));
  if (steps.some((s) => !s.pass)) throw new Error("failed: " + steps.filter((s) => !s.pass).map((s) => s.name).join("; "));
};
