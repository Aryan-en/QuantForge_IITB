import type { HostToWebview, WebviewToHost } from "@/lib/protocol";

/**
 * The only channel between the UI and the outside world (Ui-regitry §E: components never call
 * postMessage — only lib/host does). Implementations: vscodeHost (real webview) and mockHost
 * (Next.js harness, scripted scenarios).
 */
/** What the host supports, so the UI never shows a control that does nothing. */
export type HostCapabilities = {
  /** Settings and fallback models are edited in the UI (otherwise they open VS Code settings). */
  editSettings: boolean;
  /** Multiple sessions can be listed and switched. */
  sessions: boolean;
  /** A link to the session in TrueForge's own UI can be opened. */
  openInTrueForge: boolean;
};

export interface Host {
  readonly kind: "vscode" | "mock";
  readonly capabilities: HostCapabilities;
  post(message: WebviewToHost): void;
  subscribe(listener: (message: HostToWebview) => void): () => void;
}
