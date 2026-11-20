import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeWorkspace, RepoIndex, SqliteSymbolIndex, suggestMentions } from "../src/index.js";

let root: string;
let dbFile: string;
const w = (rel: string, body: string): void => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
};
beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "forge-sql-"));
  dbFile = path.join(mkdtempSync(path.join(tmpdir(), "forge-sqldb-")), "symbols.sqlite");
  w("a.py", "def get_debug_flag():\n    return 1\n\nclass ConfigLoader:\n    def load_config(self):\n        pass\n");
  w("b.py", "from a import get_debug_flag\n\ndef main():\n    return get_debug_flag()\n");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("SqliteSymbolIndex (optional Tier 1)", () => {
  it("opens when node:sqlite + FTS5 are available", () => {
    const db = SqliteSymbolIndex.open(":memory:");
    expect(db).not.toBeNull();
    db!.close();
  });

  it("writes through on parse and serves a warm start without re-parsing", async () => {
    const db1 = SqliteSymbolIndex.open(dbFile)!;
    const i1 = new RepoIndex(new NodeWorkspace(root));
    i1.attachStore(db1);
    expect(await i1.warm()).toBe(2);
    expect(i1.stats).toEqual({ parsed: 2, fromStore: 0 });
    expect(db1.stats().files).toBe(2);
    db1.close();

    // "restart": brand-new RepoIndex over the same database file
    const db2 = SqliteSymbolIndex.open(dbFile)!;
    const i2 = new RepoIndex(new NodeWorkspace(root));
    i2.attachStore(db2);
    await i2.warm();
    expect(i2.stats).toEqual({ parsed: 0, fromStore: 2 });
    expect((await i2.file("a.py"))!.symbols.map((s) => s.name)).toEqual(["get_debug_flag", "ConfigLoader", "load_config"]);
    db2.close();
  });

  it("re-parses only the file that changed (mtime/size validation) and removes deleted files", async () => {
    const db = SqliteSymbolIndex.open(dbFile)!;
    const idx = new RepoIndex(new NodeWorkspace(root));
    idx.attachStore(db);
    await idx.warm();
    w("b.py", "from a import get_debug_flag\n\ndef main():\n    return get_debug_flag()\n\ndef brand_new_symbol():\n    pass\n");
    utimesSync(path.join(root, "b.py"), new Date(), new Date(Date.now() + 5000));
    const idx2 = new RepoIndex(new NodeWorkspace(root));
    idx2.attachStore(db);
    await idx2.warm();
    expect(idx2.stats).toEqual({ parsed: 1, fromStore: 1 });
    expect(db.search("brand_new").map((s) => s.name)).toEqual(["brand_new_symbol"]);
    idx2.remove("b.py");
    expect(db.search("brand_new")).toEqual([]);
    expect(db.stats().files).toBe(1);
    db.close();
  });

  it("FTS5 ranks prefix/token matches and powers @ symbol suggestions", async () => {
    const db = SqliteSymbolIndex.open(":memory:")!;
    const idx = new RepoIndex(new NodeWorkspace(root));
    idx.attachStore(db);
    await idx.warm();
    expect(idx.warmDone).toBe(true);
    expect(db.search("debug").map((s) => s.name)).toContain("get_debug_flag");
    expect(db.search("load config").map((s) => s.name)).toEqual(expect.arrayContaining(["load_config"]));
    const sug = await suggestMentions(idx.ws, idx, "symbol:get_deb");
    expect(sug[0]).toMatchObject({ kind: "symbol", insert: "symbol:get_debug_flag@a.py" });
    db.close();
  });

  it("does not answer from a half-built index: suggestions fall back to scanning until warm-up completes", async () => {
    const db = SqliteSymbolIndex.open(":memory:")!;
    const idx = new RepoIndex(new NodeWorkspace(root));
    idx.attachStore(db);
    await idx.file("b.py"); // only one file indexed so far
    expect(idx.warmDone).toBe(false);
    const sug = await suggestMentions(idx.ws, idx, "symbol:get_debug");
    expect(sug[0]).toMatchObject({ insert: "symbol:get_debug_flag@a.py" }); // found via scan although a.py was not indexed yet
    db.close();
  });

  it("is a pure optimisation: a store that dies mid-session never breaks reads", async () => {
    const db = SqliteSymbolIndex.open(":memory:")!;
    const idx = new RepoIndex(new NodeWorkspace(root));
    idx.attachStore(db);
    db.close(); // closed under the index's feet
    const fi = await idx.file("a.py");
    expect(fi!.symbols.map((s) => s.name)).toContain("get_debug_flag");
    expect(idx.persistent).toBeNull(); // dropped after the first failure; falls back to on-demand parsing
  });
});

const flaskRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../eval/work/flask");
describe.skipIf(!existsSync(path.join(flaskRoot, "src/flask/cli.py")))("Flask 3.1.3 scale", () => {
  it("warm start from SQLite is much faster than a cold parse and returns the same symbols", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "forge-flaskdb-")), "s.sqlite");
    const db = SqliteSymbolIndex.open(file)!;
    const cold = new RepoIndex(new NodeWorkspace(flaskRoot));
    cold.attachStore(db);
    const t0 = Date.now();
    const n = await cold.warm();
    const coldMs = Date.now() - t0;
    const warm = new RepoIndex(new NodeWorkspace(flaskRoot));
    warm.attachStore(db);
    const t1 = Date.now();
    await warm.warm();
    const warmMs = Date.now() - t1;
    console.log(`flask index: ${n} files, cold ${coldMs} ms, warm ${warmMs} ms, ${JSON.stringify(db.stats())}`);
    expect(warm.stats.parsed).toBe(0);
    expect(warm.stats.fromStore).toBe(n);
    expect(warmMs).toBeLessThan(coldMs);
    expect(db.search("get_debug_flag").some((s) => s.path === "src/flask/helpers.py")).toBe(true);
    db.close();
  }, 60000);
});
