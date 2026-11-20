import * as vscode from "vscode";
import type { FileChange, FileStore } from "@forge/diff-engine";

const dec = new TextDecoder("utf-8");

/**
 * The ONLY writer of workspace files. Reads prefer dirty editor buffers (they are the source of truth); writes go
 * through one WorkspaceEdit so the batch is atomic from VS Code's point of view and lands on the editor's undo stack.
 */
export class VsCodeFileStore implements FileStore {
  constructor(private readonly root: vscode.Uri) {}
  private uri(rel: string): vscode.Uri {
    return vscode.Uri.joinPath(this.root, rel);
  }
  async read(rel: string): Promise<string | null> {
    const uri = this.uri(rel);
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (open) return open.getText();
    try {
      return dec.decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      return null;
    }
  }
  async applyBatch(changes: FileChange[]): Promise<boolean> {
    if (!vscode.workspace.isTrusted) return false;
    const we = new vscode.WorkspaceEdit();
    const touched: vscode.Uri[] = [];
    try {
      for (const c of changes) {
        const uri = this.uri(c.path);
        const exists = await vscode.workspace.fs.stat(uri).then(() => true, () => false);
        if (c.newText === null) {
          we.deleteFile(uri, { ignoreIfNotExists: true });
        } else if (exists) {
          const doc = await vscode.workspace.openTextDocument(uri);
          we.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), c.newText);
          touched.push(uri);
        } else {
          we.createFile(uri, { ignoreIfExists: false });
          we.insert(uri, new vscode.Position(0, 0), c.newText);
          touched.push(uri);
        }
      }
      const ok = await vscode.workspace.applyEdit(we);
      if (!ok) return false;
      for (const uri of touched) {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        if (doc?.isDirty) await doc.save();
      }
      return true;
    } catch {
      return false;
    }
  }
}
