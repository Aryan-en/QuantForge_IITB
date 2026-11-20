/* Orchestrator: real TrueForge + scripted model + Flask clone, then a REAL VS Code (isolated profile) runs suite.cjs. */
import { runTests, resolveCliArgsFromVSCodeExecutablePath } from "@vscode/test-electron";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
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
const scenarios = (process.env.FORGE_SCENARIOS ?? "taskA,fallback,error,resume").split(",");
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
  // FORGE_VSIX=<path>: install the packaged extension into the clean profile and test THAT copy instead of the dev folder.
  let devPath = path.join(REPO, "packages/extension");
  const extra: string[] = ["--disable-extensions"];
  if (process.env.FORGE_VSIX) {
    const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(VSCODE);
    const inst = spawnSync(cli!, [...cliArgs, "--user-data-dir", path.join(profile, "data"), "--extensions-dir", path.join(profile, "ext"), "--install-extension", process.env.FORGE_VSIX, "--force"], { encoding: "utf8" });
    console.log(`install: ${(inst.stdout + inst.stderr).trim().split("\n").slice(-2).join(" | ")}`);
    devPath = mkdtempSync(path.join(tmpdir(), "forge-stub-"));
    writeFileSync(path.join(devPath, "package.json"), JSON.stringify({ name: "stub", publisher: "x", version: "0.0.0", engines: { vscode: "^1.90.0" } }));
    extra.length = 0;
  }
  const launch = async (sc: string, outFile: string, tolerateExit = false): Promise<void> => {
  try {
    await runTests({
      vscodeExecutablePath: VSCODE,
      extensionDevelopmentPath: devPath,
      extensionTestsPath: path.join(REPO, "packages/extension/test/vscode/suite.cjs"),
      launchArgs: [ws, "--user-data-dir", path.join(profile, "data"), "--extensions-dir", path.join(profile, "ext"), ...extra, "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-telemetry"],
      extensionTestsEnv: { FORGE_TEST_OUT: outFile, FORGE_TEST_WS: ws, FORGE_TF_URL: tf.url, FORGE_TEST_MODEL: primary, FORGE_TEST_FALLBACK: fallback, FORGE_TEST_SCENARIO: sc, PATH: `${VENV_BIN}:${process.env.PATH}` },
    });
  } catch (e) {
    if (!tolerateExit) { failed = true; console.error("VS Code run reported failure:", String(e).slice(0, 200)); }
  }
  };
  let out2 = out;
  if (scenario === "resume") {
    const out1 = path.join(path.dirname(out), "window1.json");
    await launch("resume1", out1, true); // window 1 quits on purpose
    const w1 = existsSync(out1) ? (JSON.parse(readFileSync(out1, "utf8")) as { name: string; pass: boolean }[]) : [];
    for (const s of w1) console.log(`${s.pass ? "PASS" : "FAIL"}  [window 1] ${s.name}`);
    if (w1.length === 0 || w1.some((s) => !s.pass)) failed = true;
    await launch("resume2", out2);
  } else await launch(scenario, out2);
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
