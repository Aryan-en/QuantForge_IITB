import type { HostToWebview, WebviewToHost } from "@/lib/protocol";

/**
 * The only channel between the UI and the outside world (Ui-regitry §E: components never call
 * postMessage — only lib/host does). Implementations: vscodeHost (real webview) and mockHost
 * (Next.js harness, scripted scenarios).
 */
export interface Host {
  readonly kind: "vscode" | "mock";
  post(message: WebviewToHost): void;
  subscribe(listener: (message: HostToWebview) => void): () => void;
}
