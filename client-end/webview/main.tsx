import { createRoot } from "react-dom/client";
import { ForgeApp } from "@/components/forge/ForgeApp";
import { ForgeProvider } from "@/lib/host/ForgeProvider";
import { createVsCodeHost } from "@/lib/host/vscodeHost";
import "./webview.css";

/** Entry for the VS Code webview bundle (esbuild → dist/webview). No Next.js, no network, no remote fonts. */
const host = createVsCodeHost();
const root = document.getElementById("root");
if (!root) throw new Error("QuantForge webview: #root missing");
createRoot(root).render(
  <ForgeProvider host={host}>
    <ForgeApp />
  </ForgeProvider>,
);
