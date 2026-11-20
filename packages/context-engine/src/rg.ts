import { spawn } from "node:child_process";
import { rgPath as defaultRgPath } from "@vscode/ripgrep";

let rgPathOverride: string | null = null;
/** Point at a bundled ripgrep binary (the extension ships its own; require.resolve is unavailable in a bundle). */
export function setRgPath(p: string): void {
  rgPathOverride = p;
}
const rgBin = (): string => rgPathOverride ?? defaultRgPath;

export interface RgMatch {
  path: string;
  line: number;
  text: string;
}
export interface RgOptions {
  cwd: string;
  globs?: string[];
  excludeGlobs?: string[];
  signal?: AbortSignal | undefined;
  timeoutMs?: number;
}

function run(args: string[], opts: RgOptions): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const full = [...args];
    for (const g of opts.globs ?? []) full.push("-g", g);
    for (const g of opts.excludeGlobs ?? []) full.push("-g", `!${g}`);
    const child = spawn(rgBin(), full, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? 8000);
    const onAbort = (): void => {
      child.kill("SIGKILL");
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
      if (stdout.length > 32_000_000) child.kill("SIGKILL");
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < 4000) stderr += d.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.signal?.aborted) reject(new Error("cancelled"));
      else resolve({ stdout, stderr, code, timedOut });
    });
  });
}

export async function rgFiles(opts: RgOptions): Promise<string[]> {
  const r = await run(["--files", "--no-messages", "--max-filesize", "1M"], opts);
  return r.stdout.split("\n").filter(Boolean).map((p) => p.replace(/^\.\//, ""));
}

export interface SearchOptions extends RgOptions {
  query: string;
  regex?: boolean | undefined;
  caseSensitive?: boolean | undefined;
  wholeWord?: boolean | undefined;
  maxPerFile?: number | undefined;
  maxTotal?: number | undefined;
}

export async function rgSearch(o: SearchOptions): Promise<{ matches: RgMatch[]; truncated: boolean; timedOut: boolean }> {
  const args = ["--json", "--max-filesize", "1M", "--max-columns", "300", "--max-count", String(o.maxPerFile ?? 50)];
  if (!o.regex) args.push("--fixed-strings");
  if (!o.caseSensitive) args.push("--ignore-case");
  if (o.wholeWord) args.push("--word-regexp");
  args.push("-e", o.query, "--", ".");
  const r = await run(args, o);
  const matches: RgMatch[] = [];
  let truncated = false;
  const max = o.maxTotal ?? 500;
  for (const line of r.stdout.split("\n")) {
    if (!line) continue;
    let ev: { type: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type !== "match" || !ev.data?.path?.text) continue;
    if (matches.length >= max) {
      truncated = true;
      break;
    }
    matches.push({ path: ev.data.path.text.replace(/^\.\//, ""), line: ev.data.line_number ?? 0, text: (ev.data.lines?.text ?? "").replace(/\r?\n$/, "") });
  }
  if (r.code === 2 && matches.length === 0 && !r.timedOut && /regex parse error|error parsing|unrecognized|invalid/i.test(r.stderr)) throw new Error(`invalid search pattern: ${r.stderr.split("\n")[0] ?? ""}`);
  return { matches, truncated, timedOut: r.timedOut };
}
