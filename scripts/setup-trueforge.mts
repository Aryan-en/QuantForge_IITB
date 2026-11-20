/* Registers FORGE's editor tools with a running local TrueForge and lists its models — without VS Code.
 * Usage: npm run forge:setup -- --workspace <dir> [--tf http://localhost:8790] [--auto-accept]
 * Keeps the tool server running until Ctrl-C. */
import path from "node:path";
import { createToolContext, startForgeMcpHttp } from "../packages/editor-mcp/src/index.js";
import { TrueForgeApi } from "../packages/trueforge-client/src/index.js";

const arg = (n: string, d?: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const tfUrl = arg("tf", "http://localhost:8790")!;
const workspace = path.resolve(arg("workspace", process.cwd())!);

const api = new TrueForgeApi(tfUrl);
const probe = await api.probe();
if (!probe.ok) {
  console.error(`TrueForge is not reachable at ${tfUrl}: ${probe.message}\nStart it with:\n  OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]' npx --yes @truefoundry/trueforge@latest`);
  process.exit(1);
}
const ctx = await createToolContext({ root: workspace, storageDir: path.join(process.env.TMPDIR ?? "/tmp", "forge-setup"), reviewMode: process.argv.includes("--auto-accept") ? "auto-accept" : "host" });
const srv = await startForgeMcpHttp(ctx);
try {
  await api.upsertMcpServer({ name: "forge-editor", url: srv.url, token: srv.token });
} catch (e) {
  console.error(String((e as Error).message));
  await srv.close();
  process.exit(1);
}
console.log(`TrueForge reachable (${probe.latencyMs} ms). Registered MCP server "forge-editor" → ${srv.url} for ${workspace}`);
const models = await api.listModels();
console.log(models.length ? `Models available in TrueForge:\n${models.map((m) => `  - ${m.name}${m.contextLength ? `  (${m.contextLength} ctx)` : ""}`).join("\n")}` : "No models configured yet: add one in TrueForge → Settings → Models.");
console.log("Tool server running. Ctrl-C to stop.");
process.on("SIGINT", () => void srv.close().finally(() => process.exit(0)));
