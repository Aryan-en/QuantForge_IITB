import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeWorkspace, RepoIndex, assembleContext, extractTerms, parseMentions, parseFile, resolveImport, isSecretPath, renderBundle, estimateTokens } from "../src/index.js";

let root: string;
const w = (rel: string, body: string): void => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
};

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "forge-ctx-"));
  w("pkg/__init__.py", "");
  w("pkg/helpers.py", `import os\n\ndef get_debug_flag() -> bool:\n    """Get whether debug mode should be enabled."""\n    val = os.environ.get("APP_DEBUG")\n    return bool(val and val.lower() not in {"0", "false", "no"})\n\ndef unrelated():\n    return 1\n`);
  w("pkg/cli.py", `from .helpers import get_debug_flag\nfrom . import config\n\nclass Group:\n    def command(self, name):\n        return name\n\ndef main():\n    return get_debug_flag()\n`);
  w("pkg/config.py", `SECRET_KEY = "x"\nclass Config(dict):\n    def from_mapping(self, m):\n        self.update(m)\n`);
  w("tests/test_cli.py", `from pkg.cli import main\n\ndef test_main():\n    assert main() in (True, False)\n`);
  w("docs/cli.rst", `Command Line Interface\n======================\n\nThe command line tool supports commands.\n`);
  w("web/app.ts", `import { util } from "./util";\nexport function render(x: number): string { return util(x); }\nexport class View { show(): void {} }\nexport const arrow = (a: number) => a + 1;\ninterface Props { a: number }\n`);
  w("web/util.ts", `export function util(n: number): string { return String(n); }\n`);
  w(".env", "API_KEY=supersecret\n");
  w("package-lock.json", "{}\n");
  w("node_modules/dep/index.js", "module.exports = 1;\n");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("terms and mentions", () => {
  it("extracts identifiers, drops stopwords, splits snake and camel case", () => {
    const t = extractTerms("Please update the getDebugFlag and get_debug_flag functions so that 'off' is false");
    expect(t.identifiers).toEqual(expect.arrayContaining(["getDebugFlag", "get_debug_flag"]));
    expect(t.terms).toEqual(expect.arrayContaining(["debug", "flag", "false"]));
    expect(t.terms).not.toContain("the");
  });
  it("parses @file, @symbol and shorthand mentions", () => {
    const p = parseMentions("fix @file:src/a.py and @symbol:get_debug_flag@src/helpers.py also @tests/test_cli.py please");
    expect(p.mentions).toEqual([
      { kind: "symbol", name: "get_debug_flag", path: "src/helpers.py" },
      { kind: "file", path: "src/a.py" },
      { kind: "file", path: "tests/test_cli.py" },
    ]);
  });
});

describe("tree-sitter extraction", () => {
  it("python symbols, docstrings, relative imports", async () => {
    const src = `from .helpers import get_debug_flag\nimport os.path\n\nclass A:\n    def m(self):\n        '''doc here'''\n        pass\n\n@decorator\ndef f(x: int) -> int:\n    return x\n`;
    const fi = await parseFile("p/a.py", src, { size: src.length, mtimeMs: 1 });
    expect(fi.symbols.map((s) => `${s.kind}:${s.container ?? ""}.${s.name}`)).toEqual(["class:.A", "method:A.m", "function:.f"]);
    expect(fi.symbols[1]!.doc).toBe("doc here");
    expect(fi.symbols[2]!.startLine).toBe(9); // decorator line included
    expect(fi.imports).toEqual([{ module: "helpers", level: 1, names: ["get_debug_flag"] }, { module: "os.path", level: 0, names: [] }]);
  });
  it("typescript functions, classes, arrows, interfaces and imports", async () => {
    const src = `import { util } from "./util";\nexport function render(x: number): string { return util(x); }\nexport class View { show(): void {} }\nexport const arrow = (a: number) => a + 1;\ninterface Props { a: number }\n`;
    const fi = await parseFile("web/app.ts", src, { size: src.length, mtimeMs: 1 });
    expect(fi.symbols.map((s) => `${s.kind}:${s.name}`)).toEqual(["function:render", "class:View", "method:show", "function:arrow", "interface:Props"]);
    expect(fi.imports[0]!.module).toBe("./util");
  });
  it("resolves python relative and absolute imports and TS relative imports", () => {
    const files = new Set(["src/flask/cli.py", "src/flask/helpers.py", "src/flask/__init__.py", "web/util.ts", "web/app.ts"]);
    expect(resolveImport("src/flask/cli.py", { module: "helpers", level: 1, names: [] }, files)).toEqual(["src/flask/helpers.py"]);
    expect(resolveImport("tests/t.py", { module: "flask.cli", level: 0, names: [] }, files)).toEqual(["src/flask/cli.py"]);
    expect(resolveImport("web/app.ts", { module: "./util", level: 0, names: [] }, files)).toEqual(["web/util.ts"]);
  });
});

describe("assembleContext", () => {
  it("finds the defining file first, with reasons, and pulls in tests via the graph", async () => {
    const ws = new NodeWorkspace(root);
    const b = await assembleContext(ws, { query: "Make get_debug_flag treat 'off' as false" });
    expect(b.items[0]!.path).toBe("pkg/helpers.py");
    expect(b.items[0]!.reasons.join(" ")).toMatch(/defines get_debug_flag/);
    expect(b.items.map((i) => i.path)).toContain("pkg/cli.py");
  });
  it("never includes secrets, lockfiles or vendored dirs", async () => {
    const ws = new NodeWorkspace(root);
    const b = await assembleContext(ws, { query: "api key supersecret lock node_modules index", budgetTokens: 5000 });
    const paths = b.items.map((i) => i.path);
    expect(paths).not.toContain(".env");
    expect(paths).not.toContain("package-lock.json");
    expect(paths.some((p) => p.startsWith("node_modules"))).toBe(false);
    expect(isSecretPath(".env.production")).toBe(true);
  });
  it("explicit mentions are always included and ranked first", async () => {
    const ws = new NodeWorkspace(root);
    const b = await assembleContext(ws, { query: "something about rendering", mentions: [{ kind: "file", path: "docs/cli.rst" }, { kind: "symbol", name: "Config" }] });
    expect(b.items[0]!.reasons[0]).toMatch(/mentioned by user/);
    const paths = b.items.map((i) => i.path);
    expect(paths).toContain("docs/cli.rst");
    expect(paths).toContain("pkg/config.py");
  });
  it("reports unresolved mentions instead of dropping them silently", async () => {
    const ws = new NodeWorkspace(root);
    const b = await assembleContext(ws, { query: "x", mentions: [{ kind: "file", path: "nope/missing.py" }, { kind: "symbol", name: "DoesNotExist" }] });
    expect(b.warnings.join("\n")).toMatch(/missing\.py was not found/);
    expect(b.warnings.join("\n")).toMatch(/DoesNotExist was not found/);
  });
  it("token budget is a hard cap at every budget size", async () => {
    const ws = new NodeWorkspace(root);
    for (const budget of [500, 800, 1500, 4000, 24000]) {
      const b = await assembleContext(ws, { query: "debug flag cli command config helpers util render", budgetTokens: budget });
      expect(b.usedTokens).toBeLessThanOrEqual(budget);
      expect(b.items.reduce((n, i) => n + i.tokens, 0)).toBe(b.usedTokens);
      for (const i of b.items) expect(estimateTokens(i.content)).toBe(i.tokens);
    }
  });
  it("downgrades tiers instead of dropping when the budget is tight", async () => {
    const ws = new NodeWorkspace(root);
    const wide = await assembleContext(ws, { query: "debug flag helpers", budgetTokens: 24000 });
    const tight = await assembleContext(ws, { query: "debug flag helpers", budgetTokens: 120 });
    const order = ["full", "symbols", "skeleton", "path"];
    const a = wide.items.find((i) => i.path === "pkg/helpers.py")!;
    const t = tight.items.find((i) => i.path === "pkg/helpers.py");
    if (t) expect(order.indexOf(t.tier)).toBeGreaterThanOrEqual(order.indexOf(a.tier));
    expect(tight.usedTokens).toBeLessThanOrEqual(120);
  });
  it("is deterministic", async () => {
    const ws = new NodeWorkspace(root);
    const a = await assembleContext(ws, { query: "debug flag cli" });
    const b = await assembleContext(ws, { query: "debug flag cli" });
    expect(a.items.map((i) => i.path + i.tier)).toEqual(b.items.map((i) => i.path + i.tier));
  });
  it("numbers lines and wraps output in an untrusted-data envelope", async () => {
    const ws = new NodeWorkspace(root);
    const b = await assembleContext(ws, { query: "get_debug_flag" });
    expect(b.items[0]!.content).toMatch(/\n\s*3\| def get_debug_flag/);
    expect(renderBundle(b)).toMatch(/^<forge_data kind="context"/);
  });
  it("honors abort signals", async () => {
    const ws = new NodeWorkspace(root);
    const ac = new AbortController();
    ac.abort();
    await expect(assembleContext(ws, { query: "debug", signal: ac.signal })).rejects.toThrow();
  });
});

describe("RepoIndex.symbolsNamed", () => {
  it("finds methods and functions across the repo and filters by kind", async () => {
    const idx = new RepoIndex(new NodeWorkspace(root));
    expect((await idx.symbolsNamed("get_debug_flag")).map((s) => s.path)).toEqual(["pkg/helpers.py"]);
    expect((await idx.symbolsNamed("from_mapping", { kind: "method" })).length).toBe(1);
    expect((await idx.symbolsNamed("Config", { kind: "function" })).length).toBe(0);
  });
});

// Golden test against the real competition fixture (skipped when it has not been cloned: see eval/setup-flask.sh)
const flaskRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../eval/work/flask");
describe.skipIf(!existsSync(path.join(flaskRoot, "src/flask/cli.py")))("Flask 3.1.3 golden retrieval", () => {
  it("Task B: cli.py, tests/test_cli.py and docs/cli.rst land in the top 10 within budget", async () => {
    const ws = new NodeWorkspace(flaskRoot);
    const b = await assembleContext(ws, { query: 'Add a new built-in CLI command flask config that prints the loaded application\'s configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.' });
    const top = b.items.slice(0, 10).map((i) => i.path);
    expect(top).toEqual(expect.arrayContaining(["src/flask/cli.py", "tests/test_cli.py", "docs/cli.rst"]));
    expect(b.usedTokens).toBeLessThanOrEqual(b.budgetTokens);
  }, 60000);
  it("Task A: helpers.py ranks first and cites get_debug_flag", async () => {
    const ws = new NodeWorkspace(flaskRoot);
    const b = await assembleContext(ws, { query: "Treat the values 'off' and 'n' as false as well in get_debug_flag, case-insensitively, and update the docstring", budgetTokens: 8000 });
    expect(b.items[0]!.path).toBe("src/flask/helpers.py");
    expect(b.items[0]!.reasons.join(" ")).toMatch(/get_debug_flag/);
  }, 60000);
});

import { suggestMentions, scorePath } from "../src/index.js";
describe("@ mention suggestions", () => {
  it("ranks exact basename > prefix > substring > subsequence", () => {
    expect(scorePath("cli.py", "pkg/cli.py")).toBeGreaterThan(scorePath("cli", "pkg/cli.py"));
    expect(scorePath("cli", "pkg/cli.py")).toBeGreaterThan(scorePath("pkg", "pkg/cli.py"));
    expect(scorePath("pkg", "pkg/cli.py")).toBeGreaterThan(scorePath("pcl", "pkg/cli.py"));
    expect(scorePath("pcl", "pkg/cli.py")).toBeGreaterThan(0);
    expect(scorePath("zzz", "pkg/cli.py")).toBe(0);
  });
  it("suggests files by fuzzy path and symbols by name, never secrets", async () => {
    const ws = new NodeWorkspace(root);
    const idx = new RepoIndex(ws);
    const files = await suggestMentions(ws, idx, "cli");
    expect(files[0]!).toMatchObject({ kind: "file" });
    expect(files.map((s) => s.insert)).toEqual(expect.arrayContaining(["pkg/cli.py", "tests/test_cli.py", "docs/cli.rst"]));
    const syms = await suggestMentions(ws, idx, "symbol:get_debug");
    expect(syms[0]!).toMatchObject({ kind: "symbol", insert: "symbol:get_debug_flag@pkg/helpers.py" });
    expect((await suggestMentions(ws, idx, "env")).map((s) => s.insert)).not.toContain(".env");
  });
});
