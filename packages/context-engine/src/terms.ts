const STOP = new Set(("a an the and or but if then else of to in on at by for with from into onto as is are was were be been being it its this that these those there here " +
  "i we you he she they them our your their my me us do does did done doing have has had having can could should would will shall may might must not no yes " +
  "add new make create implement build write update change modify fix remove delete show print prints printed list get set use used using need needs want wants " +
  "also too very just only any all each every some such other another more most less least same different both either neither " +
  "must should please thing things stuff etc via per about above below after before during while when where which who whom whose what why how " +
  "containing contains loaded values value built builtin appear appears covered cover masked masking-as given gives returns return prints alongside along among between within without across through over under again further once than so because until against up down out off").split(/\s+/));

const SYNONYMS: Record<string, string[]> = {
  cli: ["click", "command"],
  config: ["configuration"],
  configuration: ["config"],
  documented: ["docs", "doc"],
  documentation: ["docs"],
  docs: ["documentation", "rst"],
  test: ["tests", "pytest"],
  tested: ["test", "tests"],
  json: ["jsonify"],
  masking: ["mask", "redact"],
  mask: ["redact", "hide"],
  builtin: ["built-in"],
};

export interface QueryTerms {
  terms: string[];
  /** Whole identifiers written in the query (snake_case/camelCase/dotted) — strongest signal for symbol match. */
  identifiers: string[];
}

function subwords(tok: string): string[] {
  return tok
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function extractTerms(query: string, max = 14): QueryTerms {
  const identifiers: string[] = [];
  const terms: string[] = [];
  const seen = new Set<string>();
  const push = (t: string): void => {
    const l = t.toLowerCase();
    if (l.length < 2 || STOP.has(l) || /^\d+$/.test(l) || seen.has(l)) return;
    seen.add(l);
    terms.push(l);
  };
  const quoted = [...query.matchAll(/["'`]([^"'`\n]{2,60})["'`]/g)].map((m) => m[1]!);
  const tokens = query.match(/[A-Za-z_][A-Za-z0-9_.\-]*/g) ?? [];
  for (const raw of tokens) {
    const tok = raw.replace(/[.\-]+$/, "");
    const isIdent = /[a-z][A-Z]/.test(tok) || tok.includes("_") || /^[a-z]+\.[a-z_]+/.test(tok);
    if (isIdent) {
      identifiers.push(tok);
      push(tok);
    }
    const parts = subwords(tok);
    for (const p of parts) push(p);
  }
  for (const q of quoted) if (!/\s/.test(q)) push(q);
  for (const t of [...terms]) for (const s of SYNONYMS[t] ?? []) if (terms.length < max + 6) push(s);
  return { terms: terms.slice(0, max), identifiers: [...new Set(identifiers)] };
}
