import { promises as fs, constants } from "node:fs";
import path from "node:path";
import type { ReviewQueue } from "@forge/diff-engine";
import type { NodeWorkspace } from "@forge/context-engine";

const LINK_DIRS = [".venv", "venv", "env", "node_modules", ".tox"];

/**
 * A disposable copy of the workspace with pending proposals applied, so the agent can run tests against
 * proposed code while the real tree stays untouched (ADR-004). Lives outside the user's workspace (ADR-013).
 */
export class ShadowWorkspace {
  readonly dir: string;
  constructor(private readonly real: NodeWorkspace, storageDir: string, sessionId: string, private readonly review: ReviewQueue) {
    this.dir = path.join(storageDir, "shadow", sessionId);
  }

  async sync(signal?: AbortSignal): Promise<{ copied: number; overlaid: number }> {
    await fs.mkdir(this.dir, { recursive: true });
    this.real.invalidate();
    const files = await this.real.listFiles(signal);
    const want = new Set(files);
    let copied = 0;
    for (const f of files) {
      const src = path.join(this.real.root, f);
      const dst = path.join(this.dir, f);
      try {
        const [a, b] = await Promise.all([fs.stat(src), fs.stat(dst).catch(() => null)]);
        if (b && b.size === a.size && Math.abs(b.mtimeMs - a.mtimeMs) < 1) continue;
        await fs.mkdir(path.dirname(dst), { recursive: true });
        await fs.rm(dst, { force: true });
        await fs.copyFile(src, dst, constants.COPYFILE_FICLONE);
        await fs.utimes(dst, a.atime, a.mtime);
        copied++;
      } catch {
        /* file vanished mid-sync */
      }
    }
    await this.prune(this.dir, "", want);
    for (const d of LINK_DIRS) {
      const src = path.join(this.real.root, d);
      const dst = path.join(this.dir, d);
      try {
        await fs.stat(src);
        const cur = await fs.lstat(dst).catch(() => null);
        if (!cur) await fs.symlink(src, dst, "dir");
      } catch {
        /* not present in the workspace */
      }
    }
    let overlaid = 0;
    for (const p of this.review.list()) {
      const dst = path.join(this.dir, p.path);
      if (p.kind === "delete") await fs.rm(dst, { force: true });
      else if (p.proposedText !== null) {
        await fs.mkdir(path.dirname(dst), { recursive: true });
        await fs.rm(dst, { force: true });
        await fs.writeFile(dst, p.proposedText, "utf8");
      }
      overlaid++;
    }
    return { copied, overlaid };
  }

  private async prune(abs: string, rel: string, want: Set<string>): Promise<void> {
    const entries = await fs.readdir(abs, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink() || LINK_DIRS.includes(e.name)) continue;
      if (e.isDirectory()) {
        if (e.name === "__pycache__" || e.name === ".pytest_cache") {
          await fs.rm(path.join(abs, e.name), { recursive: true, force: true });
          continue;
        }
        await this.prune(path.join(abs, e.name), r, want);
      } else if (!want.has(r) && !this.review.list().some((p) => p.path === r)) {
        await fs.rm(path.join(abs, e.name), { force: true });
      }
    }
  }

  /** Python needs the shadow's source roots first so editable installs do not import the real tree. */
  pythonPath(): string {
    const roots = [path.join(this.dir, "src"), this.dir];
    return roots.join(path.delimiter);
  }

  async dispose(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}
