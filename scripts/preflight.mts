/* Pre-recording checklist: everything that has silently ruined demos. Exit code 1 if a blocker is found.
 * Usage: npx tsx scripts/preflight.mts [--tf http://localhost:8790] */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { TrueForgeApi } from "../packages/trueforge-client/src/index.js";

const arg = (n: string, d: string): string => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1]! : d; };
const tfUrl = arg("tf", "http://localhost:8790");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const flask = path.join(root, "eval/work/flask");
let blockers = 0;
const line = (ok: boolean | "warn", msg: string): void => { console.log(`${ok === true ? "PASS" : ok === "warn" ? "WARN" : "FAIL"}  ${msg}`); if (ok === false) blockers++; };

const api = new TrueForgeApi(tfUrl);
const probe = await api.probe();
line(probe.ok, probe.ok ? `TrueForge reachable at ${tfUrl} (${probe.latencyMs} ms)` : `TrueForge NOT reachable at ${tfUrl}: start with  MODEL_HTTP_HEADERS_TIMEOUT_MS=300000 OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]' npx --yes @truefoundry/trueforge@latest`);
if (probe.ok) {
  const models = await api.listModels();
  line(models.length >= 1, `${models.length} model(s) configured in TrueForge: ${models.map((m) => m.name).slice(0, 6).join(", ") || "none"}`);
  line(models.length >= 2 ? true : "warn", models.length >= 2 ? "≥2 models: automatic fallback (Task C, rubric B3=10) can be demonstrated" : "only 1 model: Task C can show the clear-error path (B3=4) but not automatic fallback (B3=10)");
  const bad = models.filter((m) => /^(fake|bad|dead|vs[a-z]|dbg|probe)/.test(m.name));
  line(bad.length === 0 ? true : "warn", bad.length === 0 ? "no leftover test providers in TrueForge" : `leftover test providers visible in the model list (${bad.length}) — remove them before recording`);
}
line(existsSync(path.join(root, "packages/extension/dist/extension.cjs")), "extension bundle built (node scripts/build.mjs)");
line(existsSync(path.join(root, "eval/work/venv/bin/pytest")), "Flask venv + pytest present (eval/setup-flask.sh)");
if (existsSync(flask)) {
  const head = execSync("git rev-parse --short=8 HEAD", { cwd: flask }).toString().trim();
  line(head === "22d92470", `Flask checked out at ${head} (want 22d92470)`);
  const dirty = execSync("git status --porcelain", { cwd: flask }).toString().trim();
  line(dirty === "", dirty === "" ? "Flask working tree is clean (start state for Task A)" : `Flask tree is dirty — run: git -C eval/work/flask checkout . && git -C eval/work/flask clean -fd\n${dirty}`);
  const t = execSync(`${path.join(root, "eval/work/venv/bin/pytest")} tests/test_cli.py -q -p no:cacheprovider 2>&1 | tail -1`, { cwd: flask }).toString().trim();
  line(/55 passed/.test(t), `baseline pytest: ${t} (expect 55 passed, 3 skipped)`);
} else line(false, "eval/work/flask missing — run eval/setup-flask.sh");
console.log(`\n${blockers === 0 ? "READY TO RECORD" : `${blockers} blocker(s) — fix before recording`}`);
process.exit(blockers === 0 ? 0 : 1);
