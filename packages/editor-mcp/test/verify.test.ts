import { describe, it, expect } from "vitest";
import { MemoryFileStore, MemoryJournalStore, ReviewQueue, UndoJournal } from "@forge/diff-engine";
import { checkChecklist } from "../src/index.js";

const SRC = `import os\n\ndef get_debug_flag() -> bool:\n    """Get whether debug mode should be enabled.\n    The default is False.\n    """\n    val = os.environ.get("FLASK_DEBUG")\n    return bool(val and val.lower() not in {"0", "false", "no"})\n`;
async function queue() {
  const store = new MemoryFileStore({ "helpers.py": SRC });
  const j = new UndoJournal(new MemoryJournalStore()); await j.init();
  return new ReviewQueue(store, j);
}
const CODE_EDIT = { oldText: '{"0", "false", "no"}', newText: '{"0", "false", "no", "off", "n"}' };
const DOC_EDIT = { oldText: "    The default is False.\n", newText: "    The default is False. The values 0, false, no, off and n (any case) are false.\n" };
const REQS = [
  { requirement: "treat 'off' and 'n' as false", evidence: 'val.lower() not in {"0", "false", "no", "off", "n"}' },
  { requirement: "update the docstring to list every false value", evidence: "The values 0, false, no, off and n (any case) are false." },
];

describe("verify_changes checklist (catches a model that did half the task)", () => {
  it("passes when every requirement has its own evidence among the ADDED lines", async () => {
    const q = await queue();
    await q.propose({ path: "helpers.py", edits: [CODE_EDIT, DOC_EDIT], rationale: "r" });
    const r = checkChecklist(REQS, q.list());
    expect(r.ok).toBe(true);
    expect(r.results.every((x) => x.path === "helpers.py")).toBe(true);
  });
  it("THE MEASURED FAILURE: code-only edit — the docstring requirement cannot cite the same line, so it fails", async () => {
    const q = await queue();
    await q.propose({ path: "helpers.py", edits: [CODE_EDIT], rationale: "r" });
    // a model that skipped the docstring tries to claim it with the code line, or with text it never wrote
    const sameLine = checkChecklist([REQS[0]!, { requirement: REQS[1]!.requirement, evidence: REQS[0]!.evidence }], q.list());
    expect(sameLine.ok).toBe(false);
    expect(sameLine.results[1]!.reason).toMatch(/same line/);
    const invented = checkChecklist(REQS, q.list());
    expect(invented.ok).toBe(false);
    expect(invented.results[1]!.reason).toMatch(/not among the lines you added/);
  });
  it("EXISTING (unchanged) lines are not evidence — only what the agent added counts", async () => {
    const q = await queue();
    await q.propose({ path: "helpers.py", edits: [CODE_EDIT], rationale: "r" });
    const r = checkChecklist([{ requirement: "docstring exists", evidence: "Get whether debug mode should be enabled." }], q.list());
    expect(r.ok).toBe(false);
  });
  it("tolerates whitespace/case/line-number-prefix differences and small paraphrase (≥80% token overlap)", async () => {
    const q = await queue();
    await q.propose({ path: "helpers.py", edits: [CODE_EDIT, DOC_EDIT], rationale: "r" });
    const r = checkChecklist([
      { requirement: "code", evidence: '  8|   return bool(val and val.lower() NOT IN {"0",  "false", "no", "off", "n"})' },
      { requirement: "doc", evidence: "the values 0, false, no, off and n (any case) are false" },
    ], q.list());
    expect(r.ok).toBe(true);
  });
  it("removal requirements may cite a removed line; new files count their lines as added", async () => {
    const q = await queue();
    await q.propose({ path: "helpers.py", edits: [{ oldText: '    val = os.environ.get("FLASK_DEBUG")\n', newText: "" }], rationale: "r" });
    await q.propose({ path: "notes.md", newContent: "# Notes\nFlask debug flag docs\n", create: true, rationale: "r" });
    const r = checkChecklist([
      { requirement: "remove the FLASK_DEBUG lookup", evidence: 'val = os.environ.get("FLASK_DEBUG")' },
      { requirement: "document it in notes", evidence: "Flask debug flag docs" },
    ], q.list());
    expect(r.ok).toBe(true);
  });
});

describe("submit gate: send the agent back BEFORE bothering the human", () => {
  it("declines unverified submits twice, then lets the human decide (never deadlocks)", async () => {
    const q = await queue();
    expect(q.submitGate()).toEqual({ pass: true }); // nothing queued
    await q.propose({ path: "helpers.py", edits: [CODE_EDIT], rationale: "r" });
    expect(q.submitGate()).toMatchObject({ pass: false });
    expect(q.submitGate()).toMatchObject({ pass: false });
    expect(q.submitGate()).toEqual({ pass: true, unverified: true });
  });
  it("passes once verified; any later proposal invalidates the verification; snapshot keeps it", async () => {
    const q = await queue();
    await q.propose({ path: "helpers.py", edits: [CODE_EDIT], rationale: "r" });
    q.markVerified();
    expect(q.submitGate()).toEqual({ pass: true });
    const snap = q.snapshot();
    expect(snap.verified).toBe(true);
    await q.propose({ path: "helpers.py", edits: [{ oldText: "import os\n", newText: "import os\nimport sys\n" }], rationale: "r2" });
    expect(q.isVerified()).toBe(false);
    expect(q.submitGate()).toMatchObject({ pass: false });
    const q2 = await queue();
    await q2.restore(snap);
    expect(q2.isVerified()).toBe(true);
  });
});
