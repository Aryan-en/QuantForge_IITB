import { createRequire } from "node:module";
import path from "node:path";
import type { FileIndex, ImportInfo, Lang, SymbolInfo } from "./types.js";
import { langOf } from "./paths.js";

// The Microsoft-packaged runtime + grammars (MIT). Typed loosely: the package ships its own d.ts but is CJS.
type TSNode = {
  type: string;
  text: string;
  startPosition: { row: number };
  endPosition: { row: number };
  namedChildren: TSNode[];
  children: TSNode[];
  childForFieldName(name: string): TSNode | null;
  hasError: boolean;
};
type TSParser = { setLanguage(l: unknown): void; parse(src: string): { rootNode: TSNode } | null };
type TSModule = { Parser: { new (): TSParser; init(o?: unknown): Promise<void> }; Language: { load(p: string): Promise<unknown> } };

let wasmDirOverride: string | null = null;
/** Directory containing tree-sitter.js, tree-sitter.wasm and the tree-sitter-<lang>.wasm grammars (used when bundled). */
export function setWasmDir(dir: string): void {
  wasmDirOverride = dir;
}
function wasmDir(): string {
  if (wasmDirOverride) return wasmDirOverride;
  return path.dirname(createRequire(import.meta.url).resolve("@vscode/tree-sitter-wasm"));
}

let mod: TSModule | null = null;
let initPromise: Promise<void> | null = null;
const languages = new Map<Lang, unknown>();

async function ensureInit(): Promise<TSModule> {
  if (!mod) {
    mod = (wasmDirOverride ? createRequire(path.join(wasmDirOverride, "x.cjs"))("./tree-sitter.js") : createRequire(import.meta.url)("@vscode/tree-sitter-wasm")) as TSModule;
  }
  initPromise ??= mod.Parser.init({ locateFile: (f: string) => path.join(wasmDir(), f) });
  await initPromise;
  return mod;
}

async function getParser(lang: Lang): Promise<TSParser> {
  const m = await ensureInit();
  let l = languages.get(lang);
  if (!l) {
    l = await m.Language.load(path.join(wasmDir(), `tree-sitter-${lang}.wasm`));
    languages.set(lang, l);
  }
  const p = new m.Parser();
  p.setLanguage(l);
  return p;
}

function firstLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function signatureOf(node: TSNode, bodyField = "body"): string {
  const body = node.childForFieldName(bodyField);
  const full = node.text;
  if (!body) return firstLine(full.split("\n")[0] ?? full).slice(0, 240);
  const headLen = full.length - body.text.length;
  return firstLine(full.slice(0, Math.max(0, headLen))).replace(/\s*[:{]$/, "").slice(0, 300);
}

// ---------------------------------------------------------------- Python
function pyDoc(body: TSNode | null): string | undefined {
  const first = body?.namedChildren[0];
  if (first?.type === "expression_statement") {
    const s = first.namedChildren[0];
    if (s?.type === "string") return s.text.replace(/^[rubfRUBF]*("""|'''|"|')/, "").replace(/("""|'''|"|')$/, "").trim().split("\n")[0]?.slice(0, 200);
  }
  return undefined;
}

function pySymbols(root: TSNode, rel: string): SymbolInfo[] {
  const out: SymbolInfo[] = [];
  const visit = (node: TSNode, container?: string): void => {
    for (const ch of node.namedChildren) {
      let n = ch;
      if (n.type === "decorated_definition") {
        const inner = n.childForFieldName("definition") ?? n.namedChildren[n.namedChildren.length - 1];
        if (!inner) continue;
        n = inner;
      }
      if (n.type === "function_definition" || n.type === "class_definition") {
        const name = n.childForFieldName("name")?.text;
        if (!name) continue;
        const body = n.childForFieldName("body");
        const isClass = n.type === "class_definition";
        out.push({ name, kind: isClass ? "class" : container ? "method" : "function", path: rel, startLine: ch.startPosition.row + 1, endLine: n.endPosition.row + 1, signature: signatureOf(n), container, doc: pyDoc(body) });
        if (isClass && body) visit(body, name);
      } else if (!container && n.type === "expression_statement") {
        const a = n.namedChildren[0];
        if (a?.type === "assignment") {
          const left = a.childForFieldName("left");
          if (left?.type === "identifier") out.push({ name: left.text, kind: "variable", path: rel, startLine: n.startPosition.row + 1, endLine: n.endPosition.row + 1, signature: firstLine(n.text).slice(0, 160) });
        }
      } else if (n.type === "if_statement" || n.type === "try_statement" || n.type === "with_statement") {
        // module-level conditional definitions (e.g. `if t.TYPE_CHECKING:`)
        if (!container) visit(n.childForFieldName("consequence") ?? n, container);
      }
    }
  };
  visit(root);
  return out;
}

function pyImports(root: TSNode): ImportInfo[] {
  const out: ImportInfo[] = [];
  const walk = (node: TSNode): void => {
    for (const n of node.namedChildren) {
      if (n.type === "import_statement") {
        for (const c of n.namedChildren) {
          const dn = c.type === "aliased_import" ? c.childForFieldName("name") : c;
          if (dn) out.push({ module: dn.text, level: 0, names: [] });
        }
      } else if (n.type === "import_from_statement") {
        const mod = n.childForFieldName("module_name");
        const text = mod?.text ?? "";
        const level = (text.match(/^\.+/) ?? [""])[0].length;
        const names = n.namedChildren.filter((c) => c !== mod && (c.type === "dotted_name" || c.type === "aliased_import")).map((c) => (c.type === "aliased_import" ? c.childForFieldName("name")?.text ?? "" : c.text)).filter(Boolean);
        out.push({ module: text.replace(/^\.+/, ""), level, names });
      } else if (["if_statement", "try_statement", "block", "else_clause", "except_clause", "with_statement"].includes(n.type)) walk(n);
    }
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------- TS / JS
function tsSymbols(root: TSNode, rel: string): SymbolInfo[] {
  const out: SymbolInfo[] = [];
  const push = (name: string, kind: SymbolInfo["kind"], n: TSNode, outer: TSNode, container?: string): void => {
    out.push({ name, kind, path: rel, startLine: outer.startPosition.row + 1, endLine: outer.endPosition.row + 1, signature: signatureOf(n), container });
  };
  const visit = (node: TSNode, container?: string): void => {
    for (const ch of node.namedChildren) {
      let n = ch;
      if (n.type === "export_statement") {
        const d = n.childForFieldName("declaration") ?? n.namedChildren.find((c) => c.type !== "comment");
        if (!d) continue;
        n = d;
      }
      const name = n.childForFieldName("name")?.text;
      switch (n.type) {
        case "function_declaration":
        case "generator_function_declaration":
          if (name) push(name, "function", n, ch, container);
          break;
        case "class_declaration":
        case "abstract_class_declaration":
          if (name) {
            push(name, "class", n, ch, container);
            const body = n.childForFieldName("body");
            if (body) visit(body, name);
          }
          break;
        case "method_definition":
        case "method_signature":
          if (name) push(name, "method", n, ch, container);
          break;
        case "interface_declaration":
          if (name) push(name, "interface", n, ch, container);
          break;
        case "type_alias_declaration":
          if (name) push(name, "type", n, ch, container);
          break;
        case "enum_declaration":
          if (name) push(name, "enum", n, ch, container);
          break;
        case "lexical_declaration":
        case "variable_declaration":
          for (const d of n.namedChildren) {
            if (d.type !== "variable_declarator") continue;
            const vn = d.childForFieldName("name");
            const val = d.childForFieldName("value");
            if (!vn || vn.type !== "identifier") continue;
            const isFn = val && ["arrow_function", "function_expression", "function"].includes(val.type);
            push(vn.text, isFn ? "function" : "variable", isFn && val ? val : d, ch, container);
          }
          break;
        default:
          break;
      }
    }
  };
  visit(root);
  return out;
}

function tsImports(root: TSNode): ImportInfo[] {
  const out: ImportInfo[] = [];
  for (const n of root.namedChildren) {
    if (n.type === "import_statement" || n.type === "export_statement") {
      const src = n.childForFieldName("source");
      if (src) out.push({ module: src.text.replace(/^['"`]|['"`]$/g, ""), level: 0, names: [] });
    }
  }
  return out;
}

export async function parseFile(rel: string, text: string, stat: { size: number; mtimeMs: number }): Promise<FileIndex> {
  const lang = langOf(rel);
  const lineCount = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  const base: FileIndex = { path: rel, lang, lineCount, symbols: [], imports: [], size: stat.size, mtimeMs: stat.mtimeMs };
  if (!lang || text.length > 1_500_000) return base;
  try {
    const parser = await getParser(lang);
    const tree = parser.parse(text);
    if (!tree) return base;
    const root = tree.rootNode;
    if (lang === "python") return { ...base, symbols: pySymbols(root, rel), imports: pyImports(root) };
    return { ...base, symbols: tsSymbols(root, rel), imports: tsImports(root) };
  } catch {
    return base;
  }
}
