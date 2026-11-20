import path from "node:path/posix";
import type { ImportInfo } from "./types.js";
import type { RepoIndex } from "./repo-index.js";
import { isTestPath, langOf, stem } from "./paths.js";

export function resolveImport(from: string, imp: ImportInfo, files: Set<string>): string[] {
  const lang = langOf(from);
  const found: string[] = [];
  const add = (p: string): void => {
    if (files.has(p) && !found.includes(p)) found.push(p);
  };
  if (lang === "python") {
    const modPath = imp.module.replace(/\./g, "/");
    if (imp.level > 0) {
      let dir = path.dirname(from);
      for (let i = 1; i < imp.level; i++) dir = path.dirname(dir);
      const base = modPath ? path.join(dir, modPath) : dir;
      add(`${base}.py`);
      add(`${base}/__init__.py`);
      if (!modPath) for (const n of imp.names) add(path.join(dir, `${n}.py`));
    } else if (modPath) {
      const suffixes = [`${modPath}.py`, `${modPath}/__init__.py`];
      for (const f of files) if (suffixes.some((s) => f === s || f.endsWith(`/${s}`))) found.push(f);
      if (found.length > 3) found.splice(3);
      for (const n of imp.names) {
        const s = `${modPath}/${n}.py`;
        for (const f of files) if (f === s || f.endsWith(`/${s}`)) found.push(f);
      }
    }
  } else if (lang) {
    if (imp.module.startsWith(".")) {
      const base = path.normalize(path.join(path.dirname(from), imp.module));
      const noExt = base.replace(/\.[cm]?[jt]sx?$/, "");
      for (const ext of ["ts", "tsx", "js", "jsx", "mts", "cts", "mjs"]) {
        add(`${noExt}.${ext}`);
        add(`${noExt}/index.${ext}`);
      }
      add(base);
    }
  }
  return found;
}

export interface Neighbors {
  imports: string[];
  importers: string[];
  tests: string[];
}

export async function neighbors(index: RepoIndex, rel: string, files: string[], fileSet: Set<string>, signal?: AbortSignal): Promise<Neighbors> {
  const fi = await index.file(rel);
  const imports = new Set<string>();
  if (fi) for (const imp of fi.imports) for (const r of resolveImport(rel, imp, fileSet)) if (r !== rel) imports.add(r);

  const importers = new Set<string>();
  const s = stem(rel);
  if (s && s !== "__init__" && s !== "index") {
    const r = await index.ws.search({ query: `\\b${s}\\b`, regex: true, caseSensitive: true, maxPerFile: 2, maxTotal: 300, signal });
    const cands = [...new Set(r.matches.map((m) => m.path))].filter((p) => p !== rel && langOf(p)).slice(0, 40);
    for (const c of cands) {
      const cf = await index.file(c);
      if (cf?.imports.some((imp) => resolveImport(c, imp, fileSet).includes(rel))) importers.add(c);
    }
  }

  const tests: string[] = [];
  if (!isTestPath(rel)) {
    for (const f of files) {
      if (!isTestPath(f)) continue;
      const fs = stem(f);
      if (fs === `test_${s}` || fs === `${s}_test` || fs === `${s}.test` || fs === `${s}.spec` || fs === `test_${s}s`) tests.push(f);
    }
  }
  return { imports: [...imports], importers: [...importers], tests };
}
