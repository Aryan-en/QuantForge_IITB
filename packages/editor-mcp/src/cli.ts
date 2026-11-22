/* Headless runner: serves QuantForge's editor tools over MCP for a workspace folder, with no VS Code involved.
 * Used for local development, CI and the Flask evaluation harness. Prints the URL + token as JSON on stdout. */
import path from "node:path";
import { createToolContext } from "./runtime.js";
import { startForgeMcpHttp } from "./server.js";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const root = path.resolve(arg("workspace", process.cwd())!);
const ctx = await createToolContext({
  root,
  storageDir: arg("storage", path.join(process.env.TMPDIR ?? "/tmp", "forge-headless")),
  reviewMode: flag("auto-accept") ? "auto-accept" : "host",
  shadow: !flag("no-shadow"),
  extraPath: arg("extra-path") ? arg("extra-path")!.split(path.delimiter) : undefined,
  onEvent: (e) => {
    if (flag("verbose")) process.stderr.write(`[forge] ${e.type}${e.type === "timeline" ? ` ${e.event.title} ${e.event.detail ?? ""}` : ""}\n`);
  },
});
const srv = await startForgeMcpHttp(ctx, { port: Number(arg("port", "0")), token: arg("token") });
process.stdout.write(JSON.stringify({ url: srv.url, token: srv.token, workspace: root, reviewMode: ctx.reviewMode }) + "\n");
const stop = (): void => void srv.close().finally(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
