import { promises as fs } from "node:fs";
import path from "node:path";
import { contentHash } from "./text.js";

/** Abstraction over the workspace so the engine is testable and the extension can plug in WorkspaceEdit. */
export interface FileChange {
  path: string;
  /** New content; null deletes the file. */
  newText: string | null;
}

export interface FileStore {
  read(relPath: string): Promise<string | null>;
  /** Apply all changes or none. Resolves false (and leaves nothing changed) on failure. */
  applyBatch(changes: FileChange[]): Promise<boolean>;
}

export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, string>();
  failNextBatch = false;
  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.files.set(k, v);
  }
  async read(p: string): Promise<string | null> {
    return this.files.get(p) ?? null;
  }
  async applyBatch(changes: FileChange[]): Promise<boolean> {
    if (this.failNextBatch) {
      this.failNextBatch = false;
      return false;
    }
    for (const c of changes) {
      if (c.newText === null) this.files.delete(c.path);
      else this.files.set(c.path, c.newText);
    }
    return true;
  }
}

/** Real filesystem rooted at a directory. Writes via temp+rename; rolls back on partial failure. */
export class NodeFileStore implements FileStore {
  constructor(private readonly root: string) {}
  private abs(rel: string): string {
    const full = path.resolve(this.root, rel);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) throw new Error(`path escapes root: ${rel}`);
    return full;
  }
  async read(rel: string): Promise<string | null> {
    try {
      return await fs.readFile(this.abs(rel), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async applyBatch(changes: FileChange[]): Promise<boolean> {
    const before = new Map<string, string | null>();
    try {
      for (const c of changes) before.set(c.path, await this.read(c.path));
      for (const c of changes) {
        const full = this.abs(c.path);
        if (c.newText === null) await fs.rm(full, { force: true });
        else {
          await fs.mkdir(path.dirname(full), { recursive: true });
          const tmp = `${full}.forge-tmp-${process.pid}`;
          await fs.writeFile(tmp, c.newText, "utf8");
          await fs.rename(tmp, full);
        }
      }
      return true;
    } catch {
      for (const [p, prev] of before) {
        try {
          const full = this.abs(p);
          if (prev === null) await fs.rm(full, { force: true });
          else await fs.writeFile(full, prev, "utf8");
        } catch {
          /* best-effort rollback */
        }
      }
      return false;
    }
  }
}

export { contentHash };
