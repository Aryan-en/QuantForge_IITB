# Configuration

`forge.example.json` lists every QuantForge setting with safe placeholders. **Never put API keys in it.**

## Model setup (done in TrueForge, not QuantForge)
1. Start TrueForge in local mode so QuantForge's loopback tool server is reachable (TrueForge blocks loopback URLs by default):
   ```bash
   MODEL_HTTP_HEADERS_TIMEOUT_MS=300000 OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]' npx --yes @truefoundry/trueforge@latest
   ```
   (The VS Code command **QuantForge: Start TrueForge** does exactly this.)
2. Open http://localhost:8790 → **Settings → Models**. Add a catalog provider with its API key, **or** a `custom` provider pointing at any OpenAI-compatible endpoint (a local server such as Ollama/vLLM works, keeping code on your machine).
3. Put the resulting `provider/model` names in `forge.model.primary` and (optionally) `forge.model.fallbacks`.

For automatic fallback (Task C) configure **two** models.
