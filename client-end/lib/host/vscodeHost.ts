import type { HostToWebview, WebviewToHost } from "@/lib/protocol";
import { ExtensionAdapter } from "./extensionHost";
import type { Host } from "./types";

type VsCodeApi = { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void };
declare global {
  // Injected by VS Code into webviews. Must be called at most once per webview.
  function acquireVsCodeApi(): VsCodeApi;
}

let api: VsCodeApi | null = null;
function getApi(): VsCodeApi {
  if (!api) api = acquireVsCodeApi();
  return api;
}

/**
 * Real bridge used by the webview bundle (client-end/webview/main.tsx). Messages from the extension
 * are translated by ExtensionAdapter; UI intents are translated back into packages/protocol messages.
 */
export function createVsCodeHost(): Host {
  const listeners = new Set<(m: HostToWebview) => void>();
  const adapter = new ExtensionAdapter(
    (m) => listeners.forEach((l) => l(m)),
    (m) => getApi().postMessage(m),
  );
  const onMessage = (event: MessageEvent) => adapter.receive(event.data);
  let attached = false;
  return {
    kind: "vscode",
    capabilities: { editSettings: false, sessions: false, openInTrueForge: false },
    post(message: WebviewToHost) {
      adapter.handle(message);
    },
    subscribe(listener) {
      listeners.add(listener);
      if (!attached) {
        window.addEventListener("message", onMessage);
        attached = true;
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          window.removeEventListener("message", onMessage);
          attached = false;
        }
      };
    },
  };
}
