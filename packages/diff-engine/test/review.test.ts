import { describe, it, expect } from "vitest";
import { MemoryFileStore, MemoryJournalStore, ReviewQueue, UndoJournal, ProposeError, applyLineEdits, makeHunks, applyHunks, contentHash } from "../src/index.js";

const lines = (n: number, prefix = "line") => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join("\n") + "\n";

async function setup(files: Record<string, string>) {
  const store = new MemoryFileStore(files);
  const journal = new UndoJournal(new MemoryJournalStore());
  await journal.init();
  return { store, q: new ReviewQueue(store, journal), journal };
}

describe("hunk generation", () => {
  it("splits distant changes into separate hunks and merges near ones", () => {
    const base = lines(40);
    const far = applyLineEdits(base, [{ range: { startLine: 3, endLine: 3 }, newText: "X" }, { range: { startLine: 35, endLine: 35 }, newText: "Y" }]);
    expect(makeHunks("f", "h", base, far)).toHaveLength(2);
    const near = applyLineEdits(base, [{ range: { startLine: 3, endLine: 3 }, newText: "X" }, { range: { startLine: 8, endLine: 8 }, newText: "Y" }]);
    expect(makeHunks("f", "h", base, near)).toHaveLength(1);
  });
  it("hunk ids are stable for identical input", () => {
    const base = lines(10);
    const next = applyLineEdits(base, [{ range: { startLine: 2, endLine: 2 }, newText: "Z" }]);
    expect(makeHunks("f", "h", base, next)[0]!.id).toBe(makeHunks("f", "h", base, next)[0]!.id);
  });
  it("detects EOF-newline changes", () => {
    const hunks = makeHunks("f", "h", "a\nb\n", "a\nb");
    expect(hunks).toHaveLength(1);
    expect(applyHunks("a\nb\n", hunks).text).toBe("a\nb");
  });
});

describe("applyLineEdits", () => {
  it("rejects overlapping and out-of-range edits", () => {
    expect(() => applyLineEdits(lines(5), [{ range: { startLine: 1, endLine: 3 }, newText: "x" }, { range: { startLine: 3, endLine: 4 }, newText: "y" }])).toThrow(/overlap/);
    expect(() => applyLineEdits(lines(5), [{ range: { startLine: 4, endLine: 9 }, newText: "x" }])).toThrow(/outside/);
  });
  it("empty newText deletes lines; preserves CRLF", () => {
    expect(applyLineEdits("a\nb\nc\n", [{ range: { startLine: 2, endLine: 2 }, newText: "" }])).toBe("a\nc\n");
    expect(applyLineEdits("a\r\nb\r\nc\r\n", [{ range: { startLine: 2, endLine: 2 }, newText: "B" }])).toBe("a\r\nB\r\nc\r\n");
  });
});

describe("ReviewQueue safety", () => {
  it("never writes before apply, even after accept", async () => {
    const { store, q } = await setup({ "a.txt": lines(10) });
    const before = await store.read("a.txt");
    const { proposal } = await q.propose({ path: "a.txt", edits: [{ range: { startLine: 2, endLine: 2 }, newText: "CHANGED" }], rationale: "r" });
    q.decide(proposal.id, proposal.hunks[0]!.id, "accept");
    expect(await store.read("a.txt")).toBe(before);
    const rep = await q.apply();
    expect(rep.ok).toBe(true);
    expect((await store.read("a.txt"))!.split("\n")[1]).toBe("CHANGED");
  });

  it("applies only accepted hunks (per-hunk review)", async () => {
    const { store, q } = await setup({ "a.txt": lines(40) });
    const { proposal } = await q.propose({ path: "a.txt", edits: [{ range: { startLine: 3, endLine: 3 }, newText: "FIRST" }, { range: { startLine: 35, endLine: 35 }, newText: "SECOND" }], rationale: "r" });
    expect(proposal.hunks).toHaveLength(2);
    q.decide(proposal.id, proposal.hunks[0]!.id, "accept");
    q.decide(proposal.id, proposal.hunks[1]!.id, "reject");
    await q.apply();
    const out = (await store.read("a.txt"))!;
    expect(out).toContain("FIRST");
    expect(out).not.toContain("SECOND");
    expect(out).toContain("line35");
  });

  it("undecided hunks are not applied when rejectUndecided", async () => {
    const { store, q } = await setup({ "a.txt": lines(5) });
    const base = await store.read("a.txt");
    await q.propose({ path: "a.txt", edits: [{ range: { startLine: 1, endLine: 1 }, newText: "Q" }], rationale: "r" });
    const rep = await q.apply({ rejectUndecided: true });
    expect(rep.applied).toHaveLength(0);
    expect(rep.batchId).toBeNull();
    expect(await store.read("a.txt")).toBe(base);
  });

  it("undo restores byte-identical content, including create and delete", async () => {
    const orig = { "a.txt": lines(8), "gone.txt": "bye\n" };
    const { store, q } = await setup(orig);
    const p1 = (await q.propose({ path: "a.txt", edits: [{ range: { startLine: 4, endLine: 4 }, newText: "NEW" }], rationale: "r" })).proposal;
    const p2 = (await q.propose({ path: "new.txt", newContent: "hello\n", create: true, rationale: "r" })).proposal;
    const p3 = (await q.propose({ path: "gone.txt", delete: true, rationale: "r" })).proposal;
    q.decideAll("accept");
    const rep = await q.apply();
    expect(rep.filesChanged.sort()).toEqual(["a.txt", "gone.txt", "new.txt"]);
    expect(await store.read("gone.txt")).toBeNull();
    expect(await store.read("new.txt")).toBe("hello\n");
    const u = await q.undo();
    expect(u.ok).toBe(true);
    expect(await store.read("a.txt")).toBe(orig["a.txt"]);
    expect(await store.read("gone.txt")).toBe("bye\n");
    expect(await store.read("new.txt")).toBeNull();
    expect([p1, p2, p3].every((p) => p.hunks.length > 0)).toBe(true);
  });

  it("undo refuses to clobber edits made after apply", async () => {
    const { store, q } = await setup({ "a.txt": lines(6) });
    const { proposal } = await q.propose({ path: "a.txt", edits: [{ range: { startLine: 2, endLine: 2 }, newText: "X" }], rationale: "r" });
    q.decide(proposal.id, proposal.hunks[0]!.id, "accept");
    await q.apply();
    store.files.set("a.txt", (await store.read("a.txt"))! + "user typed this\n");
    const u = await q.undo();
    expect(u.ok).toBe(false);
    expect(u.conflicts).toEqual(["a.txt"]);
    expect((await store.read("a.txt"))!).toContain("user typed this");
  });

  it("failed batch leaves nothing applied and hunks stay accepted", async () => {
    const { store, q } = await setup({ "a.txt": lines(6) });
    const base = await store.read("a.txt");
    const { proposal } = await q.propose({ path: "a.txt", edits: [{ range: { startLine: 2, endLine: 2 }, newText: "X" }], rationale: "r" });
    q.decide(proposal.id, proposal.hunks[0]!.id, "accept");
    store.failNextBatch = true;
    const rep = await q.apply();
    expect(rep.ok).toBe(false);
    expect(await store.read("a.txt")).toBe(base);
    expect(q.get(proposal.id)!.states.get(proposal.hunks[0]!.id)).toBe("accepted");
    expect((await q.apply()).ok).toBe(true);
  });

  it("rejects stale base hash", async () => {
    const { q } = await setup({ "a.txt": lines(5) });
    await expect(q.propose({ path: "a.txt", baseHash: "0".repeat(64), edits: [{ range: { startLine: 1, endLine: 1 }, newText: "x" }], rationale: "r" })).rejects.toMatchObject({ code: "STALE_BASE" });
  });

  it("detects concurrent edit elsewhere: hunk relocates and applies without losing the user's edit", async () => {
    const { store, q } = await setup({ "a.txt": lines(40) });
    const { proposal } = await q.propose({ path: "a.txt", edits: [{ range: { startLine: 30, endLine: 30 }, newText: "AGENT" }], rationale: "r" });
    // user inserts 3 lines at top while review is pending
    store.files.set("a.txt", "u1\nu2\nu3\n" + lines(40));
    await q.refresh();
    expect(q.get(proposal.id)!.states.get(proposal.hunks[0]!.id)).toBe("stale");
    q.decide(proposal.id, proposal.hunks[0]!.id, "accept");
    const rep = await q.apply();
    expect(rep.applied).toHaveLength(1);
    const out = (await store.read("a.txt"))!;
    expect(out.startsWith("u1\nu2\nu3\n")).toBe(true);
    expect(out).toContain("AGENT");
    expect(out).not.toContain("line30\n");
  });

  it("conflicting concurrent edit is never overwritten", async () => {
    const { store, q } = await setup({ "a.txt": lines(10) });
    const { proposal } = await q.propose({ path: "a.txt", edits: [{ range: { startLine: 5, endLine: 5 }, newText: "AGENT" }], rationale: "r" });
    store.files.set("a.txt", lines(10).replace("line5", "USER"));
    q.decide(proposal.id, proposal.hunks[0]!.id, "accept");
    const rep = await q.apply();
    expect(rep.applied).toHaveLength(0);
    expect(rep.conflicted).toHaveLength(1);
    expect(await store.read("a.txt")).toContain("USER");
    expect(await store.read("a.txt")).not.toContain("AGENT");
  });

  it("chained proposals on one file fold into one proposal based on the original", async () => {
    const { store, q } = await setup({ "a.txt": lines(20) });
    const original = (await store.read("a.txt"))!;
    await q.propose({ path: "a.txt", edits: [{ range: { startLine: 2, endLine: 2 }, newText: "ONE" }], rationale: "r1" });
    const eff = await q.effectiveText("a.txt");
    expect(eff.fromProposal).toBe(true);
    await q.propose({ path: "a.txt", baseHash: contentHash(eff.text!), edits: [{ range: { startLine: 15, endLine: 15 }, newText: "TWO" }], rationale: "r2" });
    expect(q.list()).toHaveLength(1);
    expect(q.list()[0]!.baseText).toBe(original);
    q.decideAll("accept");
    await q.apply();
    const out = (await store.read("a.txt"))!;
    expect(out).toContain("ONE");
    expect(out).toContain("TWO");
  });

  it("no-op and invalid edits are rejected with typed errors", async () => {
    const { q } = await setup({ "a.txt": "x\n" });
    await expect(q.propose({ path: "a.txt", newContent: "x\n", rationale: "r" })).rejects.toBeInstanceOf(ProposeError);
    await expect(q.propose({ path: "missing.txt", edits: [{ range: { startLine: 1, endLine: 1 }, newText: "a" }], rationale: "r" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("cancelled-turn proposals are tagged and never auto-applied", async () => {
    const { store, q } = await setup({ "a.txt": lines(5) });
    const base = await store.read("a.txt");
    await q.propose({ path: "a.txt", edits: [{ range: { startLine: 1, endLine: 1 }, newText: "Z" }], rationale: "r", turnId: "t1" });
    q.markTurnCancelled("t1");
    expect(q.view().proposals[0]!.fromCancelledTurn).toBe(true);
    await q.apply({ rejectUndecided: true });
    expect(await store.read("a.txt")).toBe(base);
  });
});

describe("property: apply then undo is identity (seeded random)", () => {
  function rng(seed: number) { let s = seed; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; }
  it("holds for 150 random multi-edit proposals incl. CRLF and no trailing newline", async () => {
    const r = rng(42);
    for (let i = 0; i < 150; i++) {
      const n = 5 + Math.floor(r() * 60);
      const eol = r() < 0.3 ? "\r\n" : "\n";
      let text = Array.from({ length: n }, (_, k) => `row ${k} ${Math.floor(r() * 1000)}`).join(eol);
      if (r() < 0.7) text += eol;
      const { store, q } = await setup({ "f.txt": text });
      const edits: { range: { startLine: number; endLine: number }; newText: string }[] = [];
      let cursor = 1;
      while (cursor <= n && edits.length < 6) {
        cursor += Math.floor(r() * 12);
        if (cursor > n) break;
        const end = Math.min(n, cursor + Math.floor(r() * 3));
        edits.push({ range: { startLine: cursor, endLine: end }, newText: r() < 0.25 ? "" : `new ${i} ${edits.length}\nextra` });
        cursor = end + 1;
      }
      if (edits.length === 0) continue;
      try { await q.propose({ path: "f.txt", edits, rationale: "r" }); } catch (e) { if (e instanceof ProposeError) continue; throw e; }
      q.decideAll("accept");
      const rep = await q.apply();
      expect(rep.conflicted).toHaveLength(0);
      const u = await q.undo();
      expect(u.ok).toBe(true);
      expect(await store.read("f.txt")).toBe(text);
    }
  });
  it("accepting all hunks reproduces the proposed text exactly", async () => {
    const r = rng(7);
    for (let i = 0; i < 100; i++) {
      const base = Array.from({ length: 30 }, (_, k) => `v${k}`).join("\n") + "\n";
      const next = base.split("\n").map((l) => (r() < 0.15 ? `${l}!` : l)).filter(() => r() > 0.05).join("\n");
      if (next === base) continue;
      const hunks = makeHunks("f", "h", base, next);
      expect(applyHunks(base, hunks).text).toBe(next);
    }
  });
});

describe("oldText replacement edits", () => {
  it("replaces a unique snippet, preserving CRLF", async () => {
    const { store, q } = await setup({ "a.py": "x = 1\r\ny = 2\r\nz = 3\r\n" });
    const { proposal } = await q.propose({ path: "a.py", edits: [{ oldText: "y = 2", newText: "y = 22" }], rationale: "r" });
    q.decideAll("accept");
    await q.apply();
    expect(await store.read("a.py")).toBe("x = 1\r\ny = 22\r\nz = 3\r\n");
    expect(proposal.hunks).toHaveLength(1);
  });
  it("errors clearly on missing or ambiguous oldText and on mixed edit kinds", async () => {
    const { q } = await setup({ "a.py": "a\nb\na\n" });
    await expect(q.propose({ path: "a.py", edits: [{ oldText: "zzz", newText: "q" }], rationale: "r" })).rejects.toThrow(/not found/);
    await expect(q.propose({ path: "a.py", edits: [{ oldText: "a", newText: "q" }], rationale: "r" })).rejects.toThrow(/more than once/);
    await expect(q.propose({ path: "a.py", edits: [{ oldText: "b", newText: "q" }, { range: { startLine: 1, endLine: 1 }, newText: "n" }], rationale: "r" })).rejects.toThrow(/mix/);
  });
});

describe("crash recovery of the undo journal", () => {
  class CrashStore extends MemoryFileStore {
    constructor(init: Record<string, string>, private readonly mode: "before" | "mid" | "after") { super(init); }
    override async applyBatch(changes: { path: string; newText: string | null }[]): Promise<boolean> {
      if (this.mode === "before") throw new Error("CRASH");
      if (this.mode === "mid") {
        const first = changes[0]!;
        if (first.newText === null) this.files.delete(first.path); else this.files.set(first.path, first.newText);
        throw new Error("CRASH");
      }
      await super.applyBatch(changes);
      throw new Error("CRASH"); // died after writing, before the journal was committed
    }
  }
  async function crashed(mode: "before" | "mid" | "after") {
    const files = { "a.txt": lines(10), "b.txt": lines(10, "bee") };
    const jstore = new MemoryJournalStore();
    const store = new CrashStore(files, mode);
    const j1 = new UndoJournal(jstore); await j1.init();
    const q1 = new ReviewQueue(store, j1);
    await q1.propose({ path: "a.txt", edits: [{ range: { startLine: 2, endLine: 2 }, newText: "A2" }], rationale: "r" });
    await q1.propose({ path: "b.txt", edits: [{ range: { startLine: 3, endLine: 3 }, newText: "B3" }], rationale: "r" });
    q1.decideAll("accept");
    await expect(q1.apply()).rejects.toThrow("CRASH");
    // "restart": fresh queue + journal over the same persisted journal and the same disk
    const plain = new MemoryFileStore(Object.fromEntries(store.files));
    const j2 = new UndoJournal(jstore); await j2.init();
    expect(j2.hasPending()).toBe(true);
    const q2 = new ReviewQueue(plain, j2);
    return { files, plain, j2, q2, report: await q2.reconcile() };
  }
  it("crash BEFORE any write: intent dropped, nothing to undo, files pristine", async () => {
    const { plain, j2, report, files } = await crashed("before");
    expect(report.rolledBack).toHaveLength(1);
    expect(j2.size()).toBe(0);
    expect(j2.hasPending()).toBe(false);
    expect(await plain.read("a.txt")).toBe(files["a.txt"]);
  });
  it("crash AFTER all writes but before commit: batch is recovered and undo restores everything", async () => {
    const { plain, q2, report, files } = await crashed("after");
    expect(report.committed).toHaveLength(1);
    expect((await q2.undo()).ok).toBe(true);
    expect(await plain.read("a.txt")).toBe(files["a.txt"]);
    expect(await plain.read("b.txt")).toBe(files["b.txt"]);
  });
  it("crash MID-batch: only the files that changed are undoable; the rest is reported, nothing is rewritten", async () => {
    const { plain, q2, report, files } = await crashed("mid");
    expect(report.partial).toHaveLength(1);
    expect(report.partial[0]!.applied).toHaveLength(1);
    expect(report.partial[0]!.untouched).toHaveLength(1);
    const changedPath = report.partial[0]!.applied[0]!;
    const untouchedPath = report.partial[0]!.untouched[0]!;
    expect(await plain.read(untouchedPath)).toBe(files[untouchedPath as "a.txt"]);
    expect((await q2.undo()).ok).toBe(true);
    expect(await plain.read(changedPath)).toBe(files[changedPath as "a.txt"]);
  });
  it("a file edited by the user after the crash is never clobbered by recovery or undo", async () => {
    const { plain, q2, report } = await crashed("after");
    expect(report.committed).toHaveLength(1);
    plain.files.set("a.txt", "user rewrote this\n");
    const u = await q2.undo();
    expect(u.ok).toBe(false);
    expect(await plain.read("a.txt")).toBe("user rewrote this\n");
  });
});

describe("queue snapshot / restore (survives a window reload)", () => {
  it("restores proposals, per-hunk decisions and still applies/undoes correctly", async () => {
    const a = await setup({ "a.txt": lines(40), "b.txt": "x\n" });
    const { proposal } = await a.q.propose({ path: "a.txt", edits: [{ range: { startLine: 3, endLine: 3 }, newText: "FIRST" }, { range: { startLine: 35, endLine: 35 }, newText: "SECOND" }], rationale: "r", turnId: "t9" });
    await a.q.propose({ path: "new.txt", newContent: "hi\n", create: true, rationale: "r" });
    a.q.decide(proposal.id, proposal.hunks[0]!.id, "accept");
    a.q.decide(proposal.id, proposal.hunks[1]!.id, "reject");
    const snap = JSON.parse(JSON.stringify(a.q.snapshot()));
    const b = await setup(Object.fromEntries(a.store.files));
    await b.q.restore(snap);
    expect(b.q.list().map((p) => p.path).sort()).toEqual(["a.txt", "new.txt"]);
    const restored = b.q.get(proposal.id)!;
    expect(restored.states.get(proposal.hunks[0]!.id)).toBe("accepted");
    expect(restored.states.get(proposal.hunks[1]!.id)).toBe("rejected");
    expect(restored.turnId).toBe("t9");
    b.q.decideAll("accept");
    const rep = await b.q.apply();
    expect(rep.filesChanged.sort()).toEqual(["a.txt", "new.txt"]);
    expect((await b.q.undo()).ok).toBe(true);
    expect(await b.store.read("a.txt")).toBe(lines(40));
  });
  it("hunks whose file changed while the window was closed come back stale/conflicted, never silently applied", async () => {
    const a = await setup({ "a.txt": lines(10) });
    await a.q.propose({ path: "a.txt", edits: [{ range: { startLine: 5, endLine: 5 }, newText: "AGENT" }], rationale: "r" });
    const snap = a.q.snapshot();
    const b = await setup({ "a.txt": lines(10).replace("line5", "USER") });
    await b.q.restore(snap);
    b.q.decideAll("accept");
    const rep = await b.q.apply();
    expect(rep.applied).toHaveLength(0);
    expect(await b.store.read("a.txt")).toContain("USER");
  });
});
