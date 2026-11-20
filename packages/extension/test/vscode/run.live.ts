/* Orchestrator: real TrueForge + scripted model + Flask clone, then a REAL VS Code (isolated profile) runs suite.cjs. */
import { runTests } from "@vscode/test-electron";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startFakeModel } from "../../../trueforge-client/src/testing/fake-model.js";
import { ensureTrueForge, cloneFlask, gitStatus, registerProvider, REPO, VENV_BIN } from "../../../trueforge-client/test/live/harness.js";
import { taskAPolicy } from "../../../trueforge-client/test/live/policies.js";

const VSCODE = process.env.FORGE_VSCODE_EXE ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
if (!existsSync(VSCODE)) throw new Error(`VS Code not found at ${VSCODE} (set FORGE_VSCODE_EXE)`);
execSync("node scripts/build.mjs", { cwd: REPO, stdio: "inherit" });

const tf = await ensureTrueForge();
const scenarios = (process.env.FORGE_SCENARIOS ?? "taskA,fallback,error").split(",");
let allOk = true;
for (const scenario of scenarios) {
  const ws = cloneFlask();
  const fake = await startFakeModel((req) => taskAPolicy(req));
  const rnd = Math.random().toString(36).slice(2, 7);
  const good = await registerProvider(tf, `vsg${rnd}`, fake.baseUrl);
  let primary = good;
  let fallback = "";
  const extras: { close(): Promise<void> }[] = [];
  if (scenario === "fallback") {
    const bad = await startFakeModel(() => ({ type: "error", status: 401, message: "Incorrect API key provided" }));
    extras.push(bad);
    primary = await registerProvider(tf, `vsb${rnd}`, bad.baseUrl, "sk-invalid");
    fallback = good;
  } else if (scenario === "error") {
    primary = await registerProvider(tf, `vsd${rnd}`, "http://127.0.0.1:9/v1");
  }
  const out = path.join(mkdtempSync(path.join(tmpdir(), "forge-vsc-out-")), "result.json");
  const profile = mkdtempSync(path.join(tmpdir(), "forge-vsc-profile-"));
  console.log(`\n=== scenario: ${scenario}  workspace: ${ws}  primary: ${primary}  fallback: ${fallback || "-"}`);
  let failed = false;
  try {
    await runTests({
      vscodeExecutablePath: VSCODE,
      extensionDevelopmentPath: path.join(REPO, "packages/extension"),
      extensionTestsPath: path.join(REPO, "packages/extension/test/vscode/suite.cjs"),
      launchArgs: [ws, "--user-data-dir", path.join(profile, "data"), "--extensions-dir", path.join(profile, "ext"), "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-telemetry"],
      extensionTestsEnv: { FORGE_TEST_OUT: out, FORGE_TEST_WS: ws, FORGE_TF_URL: tf.url, FORGE_TEST_MODEL: primary, FORGE_TEST_FALLBACK: fallback, FORGE_TEST_SCENARIO: scenario, PATH: `${VENV_BIN}:${process.env.PATH}` },
    });
  } catch (e) {
    failed = true;
    console.error("VS Code run reported failure:", String(e).slice(0, 200));
  }
  const steps = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as { name: string; pass: boolean; detail?: string }[]) : [];
  for (const s of steps) console.log(`${s.pass ? "PASS" : "FAIL"}  ${s.name}${s.detail ? `  — ${s.detail}` : ""}`);
  const gs = gitStatus(ws);
  console.log(`git status --porcelain after scenario: ${JSON.stringify(gs)}`);
  if (gs !== "") { console.log("FAIL  git status not clean"); failed = true; }
  if (failed || steps.length === 0 || steps.some((s) => !s.pass)) allOk = false;
  await fake.close();
  for (const x of extras) await x.close();
}
await tf.stop();
if (!allOk) process.exit(1);
console.log("\nALL SCENARIOS PASSED IN REAL VS CODE");
process.exit(0);
