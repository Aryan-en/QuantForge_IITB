import { parseHostMessage, type HostToWebview, type WebviewToHost } from "@/lib/protocol";
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

/** Real bridge used by the webview bundle (client-end/webview/main.tsx). */
export function createVsCodeHost(): Host {
  return {
    kind: "vscode",
    post(message: WebviewToHost) {
      getApi().postMessage(message);
    },
    subscribe(listener: (message: HostToWebview) => void) {
      const onMessage = (event: MessageEvent) => {
        const parsed = parseHostMessage(event.data);
        if (parsed) listener(parsed);
      };
      window.addEventListener("message", onMessage);
      return () => window.removeEventListener("message", onMessage);
    },
  };
}
