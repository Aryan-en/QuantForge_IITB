# Evaluation

Fixture: `pallets/flask` @ **3.1.3** = commit `22d92470` (verified: `git rev-parse --short=8 3.1.3`). Baseline `pytest tests/test_cli.py -q` → **55 passed, 3 skipped**.

```bash
eval/setup-flask.sh        # clone + checkout + venv with editable install (pytest<9: Flask 3.1.3's tests import a symbol newer pytest removed)
eval/run-fixed-tasks.sh    # automated checks (scripted model) — plumbing, safety, resilience
```

## What the automated checks do and do not prove
They use a **scripted, deterministic fake model** (`packages/trueforge-client/src/testing/fake-model.ts`) behind a real TrueForge, real MCP tools, the real Flask repo and (for `test:vscode`) a real VS Code. They prove the system around the model works. They say **nothing** about LLM quality.

## Running the real tasks with a real model (what judges see)
1. `FORGE: Start TrueForge`, add a model in TrueForge → Settings → Models (and a second one for fallback); set `forge.model.primary` / `forge.model.fallbacks`.
2. Open `eval/work/flask` in VS Code (add `.venv` or set `forge.agent.pythonBin` to `eval/work/venv/bin`).
3. Task A / B / C exactly as in `context/plan.md §G`.
Record model names, where they ran and cost for the write-up.

## Real-model runs (honest results)
`npm run eval:real -- --model <provider/model> --task A|B|C|all [--fallback-from <dead/model>] [--params '{"reasoning_effort":"none"}'] [--stall-sec 600]` runs the fixed tasks through TrueForge with a **real** model, simulates the reviewer accepting every hunk, verifies with the statement's own commands, and writes pass **and** fail to `eval/results/`. Last results (qwen3-8b via Ollama, 16 GB laptop): Task A 3/3, Task C fallback OK, Task B not achieved (model calls took 2–4 min). See `context/progress_tracker.md`.
Local-model setup: `ollama create qwen3-forge -f Modelfile` with `FROM qwen3:8b` / `PARAMETER num_ctx 16384`; add it in TrueForge as a `custom` provider (`http://127.0.0.1:11434/v1`, model id `qwen3-forge`, `context_length 16384`); start TrueForge with `MODEL_HTTP_HEADERS_TIMEOUT_MS=300000`.
