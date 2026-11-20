import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createToolContext, startForgeMcpHttp, type RunningServer, type ToolContext, type ForgeEvent } from "@forge/editor-mcp";
import { TrueForgeApi, loadAgent, type AgentSpec } from "../../src/index.js";

export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
export const FLASK = path.join(REPO, "eval/work/flask");
export const VENV_BIN = path.join(REPO, "eval/work/venv/bin");
export const AGENTS = path.join(REPO, "agents");
export const haveFixture = existsSync(path.join(FLASK, "src/flask/cli.py")) && existsSync(path.join(VENV_BIN, "pytest"));

export interface TF {
  url: string;
  api: TrueForgeApi;
  stop(): Promise<void>;
}

/** Use FORGE_TF_URL if given, else probe the default port, else spawn real TrueForge in local mode (network needed for npx). */
export async function ensureTrueForge(): Promise<TF> {
  const url = process.env.FORGE_TF_URL ?? "http://localhost:18790";
  let proc: ChildProcess | null = null;
  let dir = "";
  let api = new TrueForgeApi(url);
  if (!(await api.probe(1500)).ok) {
    const port = Number(new URL(url).port || 18790);
    dir = mkdtempSync(path.join(tmpdir(), "forge-tf-"));
    proc = spawn("npx", ["--yes", "@truefoundry/trueforge@latest", "--port", String(port)], {
      env: { ...process.env, SQLITE_PATH: path.join(dir, "db.sqlite"), OUTBOUND_URL_ALLOWED_HOSTS: '["127.0.0.1"]', PORT: String(port) },
      stdio: "ignore",
      detached: true,
    });
    api = new TrueForgeApi(url);
    const t0 = Date.now();
    while (Date.now() - t0 < 90_000 && !(await api.probe(1500)).ok) await new Promise((r) => setTimeout(r, 1500));
    if (!(await api.probe(1500)).ok) throw new Error("TrueForge did not start");
  }
  return {
    url, api,
    async stop() {
      if (proc?.pid) try { process.kill(-proc.pid, "SIGKILL"); } catch { /* gone */ }
      if (dir) rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function cloneFlask(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "forge-flask-"));
  execSync(`git clone -q --local "${FLASK}" "${dir}" && git -C "${dir}" checkout -q 3.1.3`, { stdio: "ignore" });
  return dir;
}
export const gitStatus = (dir: string): string => execSync("git status --porcelain", { cwd: dir }).toString();

export async function registerProvider(tf: TF, name: string, baseUrl: string, apiKey = "sk-test"): Promise<string> {
  const manifest = { type: "custom", name, base_url: baseUrl, auth: { api_key: apiKey }, models: [{ name: "mdl", model_id: "fake-model", properties: { context_length: 128000, max_output_tokens: 4096 } }] };
  let r = await fetch(`${tf.url}/api/v1/settings/model-providers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest }) });
  if (!r.ok) r = await fetch(`${tf.url}/api/v1/settings/model-providers`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest }) });
  if (!r.ok) throw new Error(`provider registration failed: ${r.status} ${await r.text()}`);
  return `${name}/mdl`;
}

export interface ForgeRig {
  ctx: ToolContext;
  srv: RunningServer;
  events: ForgeEvent[];
  mcpName: string;
  specFor(agent: "forge-agent" | "forge-inline-edit"): (model: string) => Promise<AgentSpec>;
  close(): Promise<void>;
}

export async function startRig(tf: TF, workspace: string, storage: string): Promise<ForgeRig> {
  const events: ForgeEvent[] = [];
  const ctx = await createToolContext({ root: workspace, storageDir: storage, reviewMode: "host", extraPath: [VENV_BIN], onEvent: (e) => events.push(e), sessionId: `live-${Date.now().toString(36)}` });
  const srv = await startForgeMcpHttp(ctx);
  const mcpName = `forge-editor`;
  await tf.api.upsertMcpServer({ name: mcpName, url: srv.url, token: srv.token });
  return {
    ctx, srv, events, mcpName,
    specFor: (agent) => async (model) => (await loadAgent(AGENTS, agent, { model, mcpServerName: mcpName })).spec,
    close: () => srv.close(),
  };
}
