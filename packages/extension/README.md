# FORGE

Editor-native coding agent for VS Code. The agent loop runs on **TrueForge**; every change is proposed and reviewed hunk by hunk before it touches disk.

* **Inline edit** — select code, `Cmd/Ctrl+Alt+K`, describe the change.
* **Agent mode** — `Cmd/Ctrl+Alt+F`, describe a task; FORGE finds the files itself.
* **Safe by construction** — edits are proposals; nothing is written until you approve; undo is one command.
* **Model independent** — configure models in TrueForge (Settings → Models). Set `forge.model.primary` / `forge.model.fallbacks`.

Start TrueForge with **FORGE: Start TrueForge (local mode)**. See the repository README for setup and the competition tasks.
