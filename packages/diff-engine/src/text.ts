import { createHash } from "node:crypto";

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export type Eol = "\n" | "\r\n";

export interface Doc {
  /** Lines split on "\n" after CRLF normalisation. A trailing "" element means the text ended with a newline. */
  arr: string[];
  eol: Eol;
}

export function toDoc(text: string): Doc {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  return { arr: text.replace(/\r\n/g, "\n").split("\n"), eol: crlf > lf ? "\r\n" : "\n" };
}

export function fromArr(arr: string[], eol: Eol): string {
  const s = arr.join("\n");
  return eol === "\r\n" ? s.replace(/\n/g, "\r\n") : s;
}

/** Number of real (addressable) lines: excludes the trailing-newline sentinel. */
export function lineCount(arr: string[]): number {
  return arr.length > 0 && arr[arr.length - 1] === "" ? arr.length - 1 : arr.length;
}

export interface LineEdit {
  range: { startLine: number; endLine: number }; // 1-based inclusive
  newText: string;
}

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditError";
  }
}

/** Apply 1-based inclusive line-range replacements. Empty newText deletes the lines. Edits must not overlap. */
export function applyLineEdits(text: string, edits: LineEdit[]): string {
  const doc = toDoc(text);
  const n = lineCount(doc.arr);
  const sorted = [...edits].sort((a, b) => a.range.startLine - b.range.startLine);
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i]!;
    if (e.range.startLine < 1 || e.range.endLine > n) {
      throw new EditError(`range ${e.range.startLine}-${e.range.endLine} is outside the file (1-${n})`);
    }
    const prev = sorted[i - 1];
    if (prev && e.range.startLine <= prev.range.endLine) throw new EditError("edit ranges overlap");
  }
  const out = [...doc.arr];
  for (const e of [...sorted].reverse()) {
    const body = e.newText.replace(/\r\n/g, "\n");
    const repl = body === "" ? [] : (body.endsWith("\n") ? body.slice(0, -1) : body).split("\n");
    out.splice(e.range.startLine - 1, e.range.endLine - e.range.startLine + 1, ...repl);
  }
  return fromArr(out, doc.eol);
}

export interface ReplaceEdit {
  oldText: string;
  newText: string;
}
export type AnyEdit = LineEdit | ReplaceEdit;

const isReplace = (e: AnyEdit): e is ReplaceEdit => "oldText" in e;

/** Apply either line-range edits or exact-text replacements (not a mix). */
export function applyEdits(text: string, edits: AnyEdit[]): string {
  const reps = edits.filter(isReplace);
  if (reps.length === 0) return applyLineEdits(text, edits as LineEdit[]);
  if (reps.length !== edits.length) throw new EditError("do not mix range edits and oldText edits in one proposal");
  const doc = toDoc(text);
  let norm = doc.arr.join("\n");
  for (const e of reps) {
    const needle = e.oldText.replace(/\r\n/g, "\n");
    const first = norm.indexOf(needle);
    if (first < 0) throw new EditError("oldText was not found in the file; re-read the file and copy the text exactly (without line-number prefixes)");
    if (norm.indexOf(needle, first + 1) >= 0) throw new EditError("oldText matches more than once; include more surrounding lines to make it unique");
    norm = norm.slice(0, first) + e.newText.replace(/\r\n/g, "\n") + norm.slice(first + needle.length);
  }
  return doc.eol === "\r\n" ? norm.replace(/\n/g, "\r\n") : norm;
}
