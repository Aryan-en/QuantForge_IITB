# FORGE — client-end (frontend)

React UI for FORGE. One component source, two entry points ([ADR-009](../context/architecture.md)):

| Entry | Command | Purpose |
|---|---|---|
| Next.js harness | `npm run dev` → http://localhost:3000 | VS Code–like frame around the real UI, driven by a **scripted mock host** (Tasks A, B, C, cancel). Rehearsal/QA only — not the product. |
| Webview bundle | `npm run build:webview` → `dist/webview/main.{js,css}` | What the VS Code extension loads. Talks to the extension host via `lib/host/vscodeHost.ts`. |

```bash
npm install
npm run dev            # harness
npm run typecheck && npm run lint && npm run build
```

Plan and status: [../context/frontend-plan.md](../context/frontend-plan.md). Design rules: [../context/Ui-regitry.md](../context/Ui-regitry.md).
Layout: `components/ui` (primitives) · `components/forge` (product) · `lib/protocol` (message contract, temporary mirror of `packages/protocol`) · `lib/host` (bridge + mock host) · `lib/store` (reducer) · `styles/tokens.css`.
