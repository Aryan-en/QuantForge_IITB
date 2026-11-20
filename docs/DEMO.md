# Demo recording guide (≤ 4:00)

Rules from the statement: Tasks **A → B → C in that order**, each followed by its **on-screen verification**; show the **TrueForge session during Task B**; you may cut model-waiting time but **do not cut between giving the instruction and the diff appearing**. Public link (YouTube unlisted / Drive "anyone with the link").

## Before you press record
```bash
MODEL_HTTP_HEADERS_TIMEOUT_MS=300000 OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]' npx --yes @truefoundry/trueforge@latest   # terminal 1
npm run preflight                                                                      # must say READY TO RECORD
code --extensionDevelopmentPath="$PWD/packages/extension" "$PWD/eval/work/flask"       # or the installed .vsix
```
VS Code settings: `forge.model.primary`, `forge.model.fallbacks` (two real models), `forge.agent.pythonBin` = `<repo>/eval/work/venv/bin`. Close other windows/notifications. Have a browser tab on `http://localhost:8790` → **Sessions**. Zoom the editor font to ≥ 16 px so verification output is legible (rubric C1 "legible").

## Shot list (target timings)
| Time | Shot | Say / show |
|---|---|---|
| 0:00–0:15 | Title, one sentence | "FORGE: editor-native agent; the loop runs on TrueForge; every change is reviewed before it touches disk." Show the status line/sidebar with model + TrueForge connected. |
| 0:15–1:05 | **Task A** | Open `src/flask/helpers.py`, select `get_debug_flag`, `Cmd+Alt+K`, paste the exact instruction. **Show the diff opening in the editor** and the per-hunk **Accept / Reject** CodeLens; accept; then in terminal: `FLASK_DEBUG=off eval/work/venv/bin/python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` → **`False`**. Optionally show **Undo**. |
| 1:05–2:40 | **Task B** | Sidebar, mention no files, paste the exact instruction. Show **Context** tab (files + reasons + token budget), the **Plan**, the **Timeline** (tool calls; sub-agent / deferred tool if the model used them), approve `run_terminal`, open **Review**: hunks across ≥3 files; accept. Terminal: `pytest tests/test_cli.py -q` → passing; run the new command against a Flask app and show masked JSON (`flask --app app config`, keys containing SECRET/PASSWORD/TOKEN/KEY → `"***"`). **Switch to the browser: TrueForge → Sessions → this session: turns and tool calls (≥ 5 s on screen).** |
| 2:40–3:40 | **Task C** | Set primary to an invalid key / dead endpoint (second working model as fallback). Repeat Task A. Show: editor stays responsive (type, scroll) during the failure; banner ("Switched to fallback model …" or the clear error); then `git -C eval/work/flask status --porcelain` → empty (no-fallback run) or only the accepted change (fallback run). |
| 3:40–4:00 | Close | One-line limitations honesty; repo URL. |

Exact instructions (verbatim, from the statement):
* **A:** `Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.`
* **B:** `Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.`
* **C:** same as A, with an unreachable endpoint or invalid key configured in TrueForge.

Reset between takes: `git -C eval/work/flask checkout . && git -C eval/work/flask clean -fd`.

## After recording
1. Note the timestamps → fill the scorecard in `docs/writeup/WRITEUP.md` (`⟦FILL⟧`), plus models/cost and honest results.
2. `npm run writeup` (must say ≤ 3 pages and 0 placeholders) → upload PDF.
3. Make the repo public, confirm `LICENSE` is visible, no keys (`git grep -nE "sk-[A-Za-z0-9]{20,}"`), confirm the video/PDF/repo links open **logged out**.
