// Bundles the VS Code extension (and the headless MCP runner) and copies runtime assets next to them.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, existsSync, copyFileSync, chmodSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ext = path.join(root, "packages/extension");
const require = createRequire(import.meta.url);
rmSync(path.join(ext, "dist"), { recursive: true, force: true });
mkdirSync(path.join(ext, "dist/wasm"), { recursive: true });
mkdirSync(path.join(ext, "dist/bin"), { recursive: true });

const common = {
  bundle: true, platform: "node", format: "cjs", target: "node20", sourcemap: true, logLevel: "info",
  define: { "import.meta.url": "__importMetaUrl" },
  banner: { js: 'const __importMetaUrl = require("url").pathToFileURL(__filename).href;' },
  alias: { "@vscode/ripgrep": path.join(ext, "build/rg-stub.mjs") },
};
await build({ ...common, entryPoints: [path.join(ext, "src/extension.ts")], outfile: path.join(ext, "dist/extension.cjs"), external: ["vscode"] });
await build({ ...common, format: "esm", entryPoints: [path.join(root, "packages/editor-mcp/src/cli.ts")], outfile: path.join(ext, "dist/forge-mcp.mjs"),
  define: { "import.meta.url": "import.meta.url" },
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' }, alias: {} });

const wasmSrc = path.dirname(require.resolve("@vscode/tree-sitter-wasm"));
// tree-sitter.js is UMD and needs __filename: ship it as .cjs so a "type":"module" package.json cannot make Node load it as ESM.
copyFileSync(path.join(wasmSrc, "tree-sitter.js"), path.join(ext, "dist/wasm/tree-sitter.cjs"));
for (const f of ["tree-sitter.wasm", "tree-sitter-python.wasm", "tree-sitter-typescript.wasm", "tree-sitter-tsx.wasm", "tree-sitter-javascript.wasm"]) copyFileSync(path.join(wasmSrc, f), path.join(ext, "dist/wasm", f));
const { rgPath } = require("@vscode/ripgrep");
if (!existsSync(rgPath)) throw new Error(`ripgrep binary not found at ${rgPath}`);
const rgDst = path.join(ext, "dist/bin", process.platform === "win32" ? "rg.exe" : "rg");
copyFileSync(rgPath, rgDst);
chmodSync(rgDst, 0o755);
copyFileSync(path.join(root, "LICENSE"), path.join(ext, "LICENSE"));
if (existsSync(path.join(root, "THIRD_PARTY_NOTICES.md"))) copyFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), path.join(ext, "THIRD_PARTY_NOTICES.md"));
cpSync(path.join(root, "agents"), path.join(ext, "agents"), { recursive: true });
console.log("build complete →", path.relative(root, path.join(ext, "dist")));
