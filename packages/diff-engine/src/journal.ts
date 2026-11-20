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
  async record(batch: JournalBatch): Promise<void> {
    this.batches.push(batch);
    if (this.batches.length > this.max) this.batches.shift();
    await this.store.save(this.batches);
  }
  last(): JournalBatch | undefined {
    return this.batches[this.batches.length - 1];
  }
  get(batchId: string): JournalBatch | undefined {
    return this.batches.find((b) => b.batchId === batchId);
  }
  async remove(batchId: string): Promise<void> {
    this.batches = this.batches.filter((b) => b.batchId !== batchId);
    await this.store.save(this.batches);
  }
  size(): number {
    return this.batches.length;
  }
}
