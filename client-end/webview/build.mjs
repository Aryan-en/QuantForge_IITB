// Bundles the VS Code webview: esbuild (JS) + Tailwind CLI (CSS) -> dist/webview/{main.js,main.css}.
// No Next.js, no remote fonts, no inline scripts (CSP-safe). Run: npm run build:webview
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "webview");
mkdirSync(out, { recursive: true });
const watch = process.argv.includes("--production");

await build({
  entryPoints: [path.join(root, "webview", "main.tsx")],
  outfile: path.join(out, "main.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: watch,
  sourcemap: watch ? false : "inline",
  alias: { "@": root },
  loader: { ".css": "empty" }, // CSS is built separately by Tailwind
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "production" : "development") },
  logLevel: "info",
});

execFileSync(
  process.execPath,
  [path.join(root, "node_modules", "@tailwindcss", "cli", "dist", "index.mjs"), "-i", path.join(root, "webview", "webview.css"), "-o", path.join(out, "main.css"), ...(watch ? ["--minify"] : [])],
  { stdio: "inherit", cwd: root },
);
console.log("QuantForge webview built ->", out);
