import { promises as fs } from "node:fs";
import path from "node:path";
import { fail, type ToolFailure } from "@forge/protocol";
import { isSecretPath } from "@forge/context-engine";

export interface ResolvedPath {
  /** Absolute path on disk. */
  abs: string;
  /** Workspace-relative POSIX path. */
  rel: string;
}

const DENY_WRITE = [/(^|\/)\.git(\/|$)/, /(^|\/)node_modules(\/|$)/];

/**
 * Resolve a model-supplied path to a location inside `root`. Rejects traversal, NUL bytes, absolute paths
 * outside the workspace, and symlink escapes (checked via realpath of the nearest existing ancestor).
 */
export async function resolveWorkspacePath(
  root: string,
  input: string,
  opts: { mustExist?: boolean; forWrite?: boolean; allowSecrets?: boolean } = {},
): Promise<ResolvedPath | ToolFailure> {
  if (input.includes("\0")) return fail("INVALID_INPUT", "path contains a NUL byte");
  const rootReal = await fs.realpath(root);
  const candidate = path.isAbsolute(input) ? path.normalize(input) : path.resolve(rootReal, input);
  const within = (p: string): boolean => p === rootReal || p.startsWith(rootReal + path.sep);
  // The absolute path may be given through a non-canonical alias of the root (e.g. /var vs /private/var).
  let abs = candidate;
  if (path.isAbsolute(input) && !within(candidate)) {
    const rootAlias = path.resolve(root);
    if (candidate === rootAlias || candidate.startsWith(rootAlias + path.sep)) abs = path.join(rootReal, path.relative(rootAlias, candidate));
  }
  if (!within(abs)) return fail("PATH_OUTSIDE_WORKSPACE", `path is outside the workspace: ${input}`, "use a workspace-relative path such as src/app.py");

  // realpath of the deepest existing ancestor must still be inside the workspace (blocks symlink escapes)
  let probe = abs;
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      if (!within(real)) return fail("PATH_OUTSIDE_WORKSPACE", `path resolves outside the workspace via a symlink: ${input}`);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT" && (e as NodeJS.ErrnoException).code !== "ENOTDIR") return fail("INTERNAL", `cannot resolve path: ${(e as Error).message}`);
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }
  const rel = path.relative(rootReal, abs).split(path.sep).join("/");
  if (rel === "") return { abs, rel: "." };
  if (!opts.allowSecrets && isSecretPath(rel)) return fail("DENIED", `access to ${rel} is denied (looks like a secret)`, "secrets are never exposed to the agent");
  if (opts.forWrite && DENY_WRITE.some((r) => r.test(rel))) return fail("DENIED", `${rel} is a protected location`);
  if (opts.mustExist) {
    try {
      await fs.stat(abs);
    } catch {
      return fail("NOT_FOUND", `${rel} does not exist`);
    }
  }
  return { abs, rel };
}

export const isFailure = (x: unknown): x is ToolFailure => typeof x === "object" && x !== null && (x as { ok?: unknown }).ok === false;

export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export function truncate(s: string, max: number): { text: string; truncated: boolean } {
  return s.length <= max ? { text: s, truncated: false } : { text: s.slice(0, max), truncated: true };
}
