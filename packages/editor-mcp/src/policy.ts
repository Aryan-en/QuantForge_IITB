export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
  argv?: string[];
  env?: Record<string, string>;
  /** Command is a read-only git query and should run in the real workspace. */
  git?: boolean;
}

/** Minimal POSIX-ish tokenizer: handles quotes and escapes; reports shell metacharacters instead of interpreting them. */
export function tokenize(cmd: string): { tokens: string[]; metachar: string | null } {
  const tokens: string[] = [];
  let cur = "";
  let has = false;
  let q: '"' | "'" | null = null;
  let meta: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;
    if (q) {
      if (c === q) q = null;
      else if (c === "\\" && q === '"' && i + 1 < cmd.length) cur += cmd[++i];
      else if (c === "$" && q === '"' && cmd[i + 1] === "(") meta ??= "$(";
      else if (c === "`" && q === '"') meta ??= "`";
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) tokens.push(cur);
      cur = "";
      has = false;
    } else if (c === "\\" && i + 1 < cmd.length) {
      cur += cmd[++i];
      has = true;
    } else if ("|&;<>`".includes(c)) {
      meta ??= c;
    } else if (c === "$" && cmd[i + 1] === "(") {
      meta ??= "$(";
    } else {
      cur += c;
      has = true;
    }
  }
  if (q) meta ??= "unterminated quote";
  if (has || cur) tokens.push(cur);
  return { tokens, metachar: meta };
}

const PROGRAMS = new Set(["pytest", "python", "python3", "node", "npm", "git", "ls", "cat", "head", "tail", "wc", "grep", "rg", "find", "flask", "ruff", "mypy", "pyflakes", "tsc", "vitest", "eslint", "pwd", "echo", "diff", "sort", "uniq", "which", "env", "true", "false", "test", "tox", "pip", "pip3", "uv"]);
const ALWAYS_DENY = new Set(["sudo", "su", "rm", "rmdir", "mv", "cp", "dd", "mkfs", "chmod", "chown", "curl", "wget", "ssh", "scp", "nc", "ncat", "kill", "killall", "pkill", "shutdown", "reboot", "bash", "sh", "zsh", "fish", "eval", "exec", "xargs", "open", "osascript", "brew", "apt", "apt-get", "docker", "kubectl", "npx", "pnpm", "yarn", "make"]);
const GIT_READONLY = new Set(["status", "diff", "log", "show", "branch", "rev-parse", "ls-files", "blame", "describe"]);
const NPM_OK = new Set(["test", "run", "ls", "list", "outdated"]);
const BAD_ENV = /^(PATH|HOME|SHELL|USER|LD_[A-Z_]*|DYLD_[A-Z_]*|PYTHONPATH|PYTHONSTARTUP|PYTHONHOME|NODE_OPTIONS|NODE_PATH|BASH_ENV|ENV|IFS|GIT_[A-Z_]*|NPM_CONFIG_[A-Z_]*)$/;
const FIND_BAD = new Set(["-exec", "-execdir", "-delete", "-ok", "-okdir", "-fprint", "-fprintf"]);

export interface PolicyOptions {
  extraAllow?: string[];
}

export function evaluateCommand(command: string, opts: PolicyOptions = {}): PolicyDecision {
  const { tokens, metachar } = tokenize(command.trim());
  if (tokens.length === 0) return { allowed: false, reason: "empty command" };
  if (metachar) return { allowed: false, reason: `shell syntax (${metachar}) is not allowed; run one program per call and use the cwd parameter instead of "cd"` };
  const env: Record<string, string> = {};
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]!)) {
    const eq = tokens[i]!.indexOf("=");
    const k = tokens[i]!.slice(0, eq);
    if (BAD_ENV.test(k)) return { allowed: false, reason: `setting ${k} is not allowed` };
    env[k] = tokens[i]!.slice(eq + 1);
    i++;
  }
  const argv = tokens.slice(i);
  const prog = argv[0];
  if (!prog) return { allowed: false, reason: "no program given" };
  const base = prog.split("/").pop()!;
  if (prog.includes("/") && !/^\.?\.?\/?(\.venv|venv|node_modules\/\.bin)\//.test(prog) && !prog.startsWith("./")) return { allowed: false, reason: `program path "${prog}" is not allowed; use a bare program name` };
  if (ALWAYS_DENY.has(base)) return { allowed: false, reason: `"${base}" is not permitted` };
  if (!PROGRAMS.has(base) && !opts.extraAllow?.includes(base)) return { allowed: false, reason: `"${base}" is not on the allowlist (${[...PROGRAMS].slice(0, 12).join(", ")}, …)` };
  const sub = argv[1] ?? "";
  if (base === "git") {
    if (!GIT_READONLY.has(sub)) return { allowed: false, reason: `git ${sub} is not allowed (read-only git only: ${[...GIT_READONLY].join(", ")})` };
    if (sub === "branch" && argv.slice(2).some((a) => !a.startsWith("-") || /^-[dDmMcC]/.test(a))) return { allowed: false, reason: "git branch may only list branches" };
    return { allowed: true, argv, env, git: true };
  }
  if (base === "npm" && !NPM_OK.has(sub)) return { allowed: false, reason: `npm ${sub} is not allowed (only ${[...NPM_OK].join(", ")})` };
  if ((base === "pip" || base === "pip3") && !["list", "show", "freeze", "check"].includes(sub)) return { allowed: false, reason: "pip may only inspect (list/show/freeze/check); installing packages is not permitted" };
  if (base === "uv" && !["run", "pip"].includes(sub)) return { allowed: false, reason: "uv: only `uv run` is permitted" };
  if (base === "find" && argv.some((a) => FIND_BAD.has(a))) return { allowed: false, reason: "find with -exec/-delete is not allowed" };
  if (base === "env" && argv.length > 1) return { allowed: false, reason: "env may only be run without arguments" };
  if ((base === "python" || base === "python3") && argv.includes("-m") && ["pip", "ensurepip", "venv"].includes(argv[argv.indexOf("-m") + 1] ?? "")) return { allowed: false, reason: "python -m pip/venv is not permitted" };
  return { allowed: true, argv, env };
}
