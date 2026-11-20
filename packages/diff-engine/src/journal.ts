import { promises as fs } from "node:fs";
import path from "node:path";

export interface JournalEntry {
  path: string;
  /** Content before the batch was applied; null means the file did not exist (undo deletes it). */
  preText: string | null;
  /** Hash of the content written by the batch; null means the batch deleted the file. */
  postHash: string | null;
}
export interface JournalBatch {
  batchId: string;
  at: string;
  entries: JournalEntry[];
  /** "pending" = intent written, apply not yet confirmed (a crash may have happened). Absent = committed. */
  status?: "pending" | "committed";
}

export interface ReconcileReport {
  committed: string[];
  rolledBack: string[];
  partial: { batchId: string; applied: string[]; untouched: string[]; changedSince: string[] }[];
}

export interface JournalStore {
  load(): Promise<JournalBatch[]>;
  save(batches: JournalBatch[]): Promise<void>;
}

export class MemoryJournalStore implements JournalStore {
  data: JournalBatch[] = [];
  async load(): Promise<JournalBatch[]> {
    return structuredClone(this.data);
  }
  async save(b: JournalBatch[]): Promise<void> {
    this.data = structuredClone(b);
  }
}

/** Persists the undo journal as JSON in extension storage (never inside the user's workspace). */
export class FileJournalStore implements JournalStore {
  constructor(private readonly file: string) {}
  async load(): Promise<JournalBatch[]> {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8")) as JournalBatch[];
    } catch {
      return [];
    }
  }
  async save(b: JournalBatch[]): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(b), "utf8");
    await fs.rename(tmp, this.file);
  }
}

export class UndoJournal {
  private batches: JournalBatch[] = [];
  constructor(private readonly store: JournalStore, private readonly max = 20) {}
  async init(): Promise<void> {
    this.batches = await this.store.load();
  }
  private committed(): JournalBatch[] {
    return this.batches.filter((b) => b.status !== "pending");
  }
  /** Write the intent BEFORE touching files so a crash mid-apply can be reconciled on the next start. */
  async begin(batch: JournalBatch): Promise<void> {
    this.batches.push({ ...batch, status: "pending" });
    await this.store.save(this.batches);
  }
  async commit(batchId: string): Promise<void> {
    const b = this.batches.find((x) => x.batchId === batchId);
    if (b) b.status = "committed";
    const done = this.committed();
    while (done.length > this.max) this.batches.splice(this.batches.indexOf(done.shift()!), 1);
    await this.store.save(this.batches);
  }
  async record(batch: JournalBatch): Promise<void> {
    await this.begin(batch);
    await this.commit(batch.batchId);
  }
  last(): JournalBatch | undefined {
    const c = this.committed();
    return c[c.length - 1];
  }
  get(batchId: string): JournalBatch | undefined {
    return this.committed().find((b) => b.batchId === batchId);
  }
  async remove(batchId: string): Promise<void> {
    this.batches = this.batches.filter((b) => b.batchId !== batchId);
    await this.store.save(this.batches);
  }
  size(): number {
    return this.committed().length;
  }
  hasPending(): boolean {
    return this.batches.some((b) => b.status === "pending");
  }

  /**
   * Startup recovery. For every batch left "pending" (host died between intent and confirmation) compare each file
   * with what the batch would have written (postHash) or replaced (preText):
   *  - all files already new  → the apply finished: commit it so Undo works;
   *  - all files still old    → the apply never happened: drop the intent;
   *  - mixed                  → keep an undoable batch for the files that did change, report the rest. Nothing is rewritten.
   */
  async reconcile(read: (p: string) => Promise<string | null>, hash: (t: string) => string): Promise<ReconcileReport> {
    const report: ReconcileReport = { committed: [], rolledBack: [], partial: [] };
    for (const b of this.batches.filter((x) => x.status === "pending")) {
      const applied: JournalEntry[] = [];
      const untouched: string[] = [];
      const changed: string[] = [];
      for (const e of b.entries) {
        const cur = await read(e.path);
        const isPost = e.postHash === null ? cur === null : cur !== null && hash(cur) === e.postHash;
        const isPre = e.preText === null ? cur === null : cur === e.preText;
        if (isPost && !isPre) applied.push(e);
        else if (isPre) untouched.push(e.path);
        else changed.push(e.path);
      }
      if (applied.length === b.entries.length) {
        b.status = "committed";
        report.committed.push(b.batchId);
      } else if (applied.length === 0 && changed.length === 0) {
        this.batches = this.batches.filter((x) => x !== b);
        report.rolledBack.push(b.batchId);
      } else {
        if (applied.length) {
          b.entries = applied;
          b.status = "committed";
        } else this.batches = this.batches.filter((x) => x !== b);
        report.partial.push({ batchId: b.batchId, applied: applied.map((e) => e.path), untouched, changedSince: changed });
      }
    }
    await this.store.save(this.batches);
    return report;
  }
}
