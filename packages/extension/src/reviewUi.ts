import * as vscode from "vscode";
import type { ReviewQueue, Proposal } from "@forge/diff-engine";

export const PROPOSED_SCHEME = "forge-proposed";

/** Serves proposed file contents so the native diff editor can show original ↔ proposed. */
export class ProposedContentProvider implements vscode.TextDocumentContentProvider {
  readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  onDidChange = this.onDidChangeEmitter.event;
  constructor(private readonly review: ReviewQueue) {}
  provideTextDocumentContent(uri: vscode.Uri): string {
    const p = this.review.list().find((x) => x.id === uri.authority);
    return p?.proposedText ?? "";
  }
}

const addDeco = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: new vscode.ThemeColor("diffEditor.insertedLineBackground"), overviewRulerColor: new vscode.ThemeColor("diffEditor.insertedTextBackground"), overviewRulerLane: vscode.OverviewRulerLane.Left });
const delDeco = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: new vscode.ThemeColor("diffEditor.removedLineBackground"), textDecoration: "line-through" });

/** Hunk-level Accept/Reject CodeLens + line decorations on the real file, driven by the Review Queue. */
export class ReviewLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  onDidChangeCodeLenses = this.emitter.event;
  constructor(private readonly review: ReviewQueue, private readonly rootUri: () => vscode.Uri | undefined) {}
  refresh(): void {
    this.emitter.fire();
    this.decorate();
  }
  private proposalFor(doc: vscode.TextDocument): Proposal | undefined {
    const root = this.rootUri();
    if (!root) return undefined;
    const rel = vscode.workspace.asRelativePath(doc.uri, false);
    return this.review.list().find((p) => p.path === rel && p.kind !== "create");
  }
  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const p = this.proposalFor(doc);
    if (!p) return [];
    const lenses: vscode.CodeLens[] = [];
    for (const h of p.hunks) {
      const state = p.states.get(h.id) ?? "pending";
      if (state === "applied" || state === "undone") continue;
      const line = Math.min(doc.lineCount - 1, Math.max(0, h.oldStart + h.lead));
      const range = new vscode.Range(line, 0, line, 0);
      const tag = state === "accepted" ? "✓ accepted" : state === "rejected" ? "✗ rejected" : state === "conflicted" ? "⚠ conflict" : state === "stale" ? "↻ file changed" : `+${h.added} −${h.removed}`;
      lenses.push(new vscode.CodeLens(range, { title: `FORGE ${tag}`, command: "" }));
      lenses.push(new vscode.CodeLens(range, { title: "Accept", command: "forge.hunk.accept", arguments: [p.id, h.id] }));
      lenses.push(new vscode.CodeLens(range, { title: "Reject", command: "forge.hunk.reject", arguments: [p.id, h.id] }));
      lenses.push(new vscode.CodeLens(range, { title: "Diff", command: "forge.hunk.diff", arguments: [p.id] }));
    }
    return lenses;
  }
  decorate(): void {
    for (const ed of vscode.window.visibleTextEditors) {
      const p = this.proposalFor(ed.document);
      const adds: vscode.Range[] = [];
      const dels: vscode.Range[] = [];
      if (p) for (const h of p.hunks) {
        if (p.states.get(h.id) === "applied" || p.states.get(h.id) === "rejected") continue;
        let line = h.oldStart;
        for (const l of h.lines) {
          if (l.kind === "context") line++;
          else if (l.kind === "del") {
            if (line < ed.document.lineCount) dels.push(new vscode.Range(line, 0, line, 0));
            line++;
          } else if (line < ed.document.lineCount) adds.push(new vscode.Range(Math.max(0, line - 1), 0, Math.max(0, line - 1), 0));
        }
      }
      ed.setDecorations(delDeco, dels);
      ed.setDecorations(addDeco, []); // proposed (added) lines are not in the buffer yet; shown in the diff editor and the sidebar
      void adds;
    }
  }
}

export async function openDiff(review: ReviewQueue, proposalId: string, root: vscode.Uri): Promise<void> {
  const p = review.get(proposalId);
  if (!p) return;
  const right = vscode.Uri.from({ scheme: PROPOSED_SCHEME, authority: p.id, path: `/${p.path}` });
  const left = vscode.Uri.joinPath(root, p.path);
  if (p.kind === "create") await vscode.commands.executeCommand("vscode.open", right);
  else await vscode.commands.executeCommand("vscode.diff", left, right, `FORGE: ${p.path} (current ↔ proposed)`);
}
