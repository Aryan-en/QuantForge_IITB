import { promises as fs } from "node:fs";
import path from "node:path";
import { rgFiles, rgSearch, type RgMatch } from "./rg.js";
import { isSecretPath } from "./paths.js";

export interface WorkspaceFacade {
  readonly root: string;
  listFiles(signal?: AbortSignal): Promise<string[]>;
  readFile(rel: string): Promise<string | null>;
  stat(rel: string): Promise<{ size: number; mtimeMs: number } | null>;
  search(q: { query: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; globs?: string[]; maxTotal?: number; maxPerFile?: number; signal?: AbortSignal | undefined }): Promise<{ matches: RgMatch[]; truncated: boolean; timedOut: boolean }>;
}

export interface NodeWorkspaceOptions {
  excludeGlobs?: string[];
  /** Allow reading secret-looking files (default false). */
  allowSecrets?: boolean;
}

const DEFAULT_EXCLUDES = ["node_modules", ".git", "dist", "build", "out", "__pycache__", "*.min.js", "*.min.css", "*.lock", "package-lock.json", "*.map", ".venv", "venv", ".tox", "*.pyc", "*.svg", "*.png", "*.jpg", "*.pdf"];

/** Filesystem + ripgrep implementation. Works in the extension host and standalone (headless). */
export class NodeWorkspace implements WorkspaceFacade {
  readonly root: string;
  private fileCache: { at: number; files: string[] } | null = null;
  private readonly excludes: string[];
  constructor(root: string, private readonly opts: NodeWorkspaceOptions = {}) {
    this.root = path.resolve(root);
    this.excludes = [...DEFAULT_EXCLUDES, ...(opts.excludeGlobs ?? [])];
  }
  invalidate(): void {
    this.fileCache = null;
  }
  async listFiles(signal?: AbortSignal): Promise<string[]> {
    if (this.fileCache && Date.now() - this.fileCache.at < 5000) return this.fileCache.files;
    const all = await rgFiles({ cwd: this.root, excludeGlobs: this.excludes, signal });
    const files = (this.opts.allowSecrets ? all : all.filter((f) => !isSecretPath(f))).sort();
    this.fileCache = { at: Date.now(), files };
    return files;
  }
  async readFile(rel: string): Promise<string | null> {
    if (!this.opts.allowSecrets && isSecretPath(rel)) return null;
    try {
      return await fs.readFile(path.join(this.root, rel), "utf8");
    } catch {
      return null;
    }
  }
  async stat(rel: string): Promise<{ size: number; mtimeMs: number } | null> {
    try {
      const s = await fs.stat(path.join(this.root, rel));
      return { size: s.size, mtimeMs: s.mtimeMs };
    } catch {
      return null;
    }
  }
  async search(q: Parameters<WorkspaceFacade["search"]>[0]): ReturnType<WorkspaceFacade["search"]> {
    const r = await rgSearch({ cwd: this.root, query: q.query, regex: q.regex, caseSensitive: q.caseSensitive, wholeWord: q.wholeWord, globs: q.globs, excludeGlobs: this.excludes, maxTotal: q.maxTotal, maxPerFile: q.maxPerFile, signal: q.signal });
    if (!this.opts.allowSecrets) r.matches = r.matches.filter((m) => !isSecretPath(m.path));
    return r;
  }
}
