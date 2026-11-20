export type Lang = "python" | "typescript" | "tsx" | "javascript";

export interface SymbolInfo {
  name: string;
  kind: "function" | "class" | "method" | "variable" | "interface" | "type" | "enum";
  path: string;
  startLine: number; // 1-based
  endLine: number;
  signature: string;
  container?: string | undefined;
  doc?: string | undefined;
}

export interface ImportInfo {
  /** Module specifier as written (e.g. "flask.cli", "helpers", "./b"). */
  module: string;
  /** Relative level for Python (number of leading dots); 0 for absolute. */
  level: number;
  names: string[];
}

export interface FileIndex {
  path: string;
  lang: Lang | null;
  lineCount: number;
  symbols: SymbolInfo[];
  imports: ImportInfo[];
  size: number;
  mtimeMs: number;
}

export type Tier = "full" | "symbols" | "skeleton" | "path";

export interface ContextItem {
  path: string;
  range?: { startLine: number; endLine: number };
  tier: Tier;
  tokens: number;
  score: number;
  reasons: string[];
  content: string;
}

export interface ExcludedItem {
  path: string;
  reason: string;
  score?: number;
}

export interface ContextBundle {
  items: ContextItem[];
  excluded: ExcludedItem[];
  usedTokens: number;
  budgetTokens: number;
  terms: string[];
  warnings: string[];
}
