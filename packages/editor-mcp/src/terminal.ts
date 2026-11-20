import { spawn } from "node:child_process";
import { evaluateCommand } from "./policy.js";

export interface RunRequest {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}
export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
  timedOut: boolean;
  cancelled: boolean;
}

const MAX_OUT = 64 * 1024;
const SECRET_ENV = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION)/i;

export function scrubbedEnv(extra: Record<string, string>, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || SECRET_ENV.test(k)) continue;
    out[k] = v;
  }
  out.CI = "1";
  out.PYTHONDONTWRITEBYTECODE = "1";
  out.NO_COLOR = "1";
  return { ...out, ...extra };
}

/** Spawn without a shell, in its own process group so cancellation/timeout kills the whole tree. */
export function runProcess(req: RunRequest): Promise<RunResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    const child = spawn(req.argv[0]!, req.argv.slice(1), { cwd: req.cwd, env: req.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const killGroup = (sig: NodeJS.Signals): void => {
      try {
        if (child.pid) process.kill(-child.pid, sig);
      } catch {
        try { child.kill(sig); } catch { /* already gone */ }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGKILL");
    }, req.timeoutMs);
    const onAbort = (): void => {
      cancelled = true;
      killGroup("SIGKILL");
    };
    if (req.signal?.aborted) onAbort();
    else req.signal?.addEventListener("abort", onAbort, { once: true });
    const add = (cur: string, d: Buffer): string => {
      if (cur.length >= MAX_OUT) {
        truncated = true;
        return cur;
      }
      const next = cur + d.toString("utf8");
      if (next.length > MAX_OUT) truncated = true;
      return next.slice(0, MAX_OUT);
    };
    child.stdout.on("data", (d: Buffer) => (stdout = add(stdout, d)));
    child.stderr.on("data", (d: Buffer) => (stderr = add(stderr, d)));
    const done = (code: number | null, extraErr?: string): void => {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", onAbort);
      killGroup("SIGKILL"); // reap stragglers in the group
      resolve({ exitCode: code, stdout, stderr: extraErr ? `${stderr}${extraErr}` : stderr, durationMs: Date.now() - started, truncated, timedOut, cancelled });
    };
    child.on("error", (e) => done(null, `spawn error: ${e.message}`));
    child.on("close", (code) => done(code));
  });
}

export { evaluateCommand };
