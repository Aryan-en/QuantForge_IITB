/** Realistic Flask 3.1.3 fixture data for the mock host (rehearsal only; never shown as the real product). */
import type { ContextItem, ContextState, FileChange, Hunk, PlanStep } from "@/lib/protocol";

export const TASK_A_INSTRUCTION =
  "Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.";

export const TASK_B_INSTRUCTION =
  'Add a new built-in CLI command flask config that prints the loaded application\'s configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.';

export const MENTION_SOURCE = [
  { kind: "file" as const, path: "src/flask/helpers.py" },
  { kind: "file" as const, path: "src/flask/cli.py" },
  { kind: "file" as const, path: "src/flask/app.py" },
  { kind: "file" as const, path: "src/flask/config.py" },
  { kind: "file" as const, path: "tests/test_cli.py" },
  { kind: "file" as const, path: "docs/cli.rst" },
  { kind: "symbol" as const, name: "get_debug_flag", path: "src/flask/helpers.py" },
  { kind: "symbol" as const, name: "routes_command", path: "src/flask/cli.py" },
  { kind: "symbol" as const, name: "FlaskGroup", path: "src/flask/cli.py" },
];

export const HELPERS_SOURCE = `def get_debug_flag() -> bool:
    """Get whether debug mode should be enabled for the app, indicated by the
    :envvar:\`FLASK_DEBUG\` environment variable. The default is \`\`False\`\`.
    """
    val = os.environ.get("FLASK_DEBUG")
    return bool(val and val.lower() not in {"0", "false", "no"})`;

const l = (kind: "context" | "add" | "del", text: string, oldNo?: number, newNo?: number) => ({ kind, text, oldNo, newNo });

export function taskAFiles(): FileChange[] {
  const logic: Hunk = {
    hunkId: "a-h1",
    proposalId: "a-p1",
    header: "@@ -31,4 +31,4 @@ def get_debug_flag() -> bool:",
    rationale: "Add 'off' and 'n' to the falsy set; value is already lower-cased so matching is case-insensitive.",
    state: "pending",
    added: 1,
    removed: 1,
    lines: [
      l("context", '    """', 30, 30),
      l("context", '    val = os.environ.get("FLASK_DEBUG")', 31, 31),
      l("del", '    return bool(val and val.lower() not in {"0", "false", "no"})', 32),
      l("add", '    return bool(val and val.lower() not in {"0", "false", "no", "off", "n"})', undefined, 32),
    ],
  };
  const doc: Hunk = {
    hunkId: "a-h2",
    proposalId: "a-p1",
    header: "@@ -27,5 +27,7 @@ def get_debug_flag() -> bool:",
    rationale: "Docstring now lists every value treated as false, as requested.",
    state: "pending",
    added: 3,
    removed: 1,
    lines: [
      l("context", "def get_debug_flag() -> bool:", 27, 27),
      l("context", '    """Get whether debug mode should be enabled for the app, indicated by the', 28, 28),
      l("del", "    :envvar:`FLASK_DEBUG` environment variable. The default is ``False``.", 29),
      l("add", "    :envvar:`FLASK_DEBUG` environment variable. The default is ``False``.", undefined, 29),
      l("add", "", undefined, 30),
      l("add", '    The values ``"0"``, ``"false"``, ``"no"``, ``"off"`` and ``"n"`` (case-', undefined, 31),
      l("add", "    insensitive) are treated as false; anything else that is set is true.", undefined, 32),
      l("context", '    """', 30, 33),
    ],
  };
  return [{ proposalId: "a-p1", path: "src/flask/helpers.py", status: "M", added: 4, removed: 2, hunks: [doc, logic].map((h) => ({ ...h })) }];
}

export function taskBFiles(): FileChange[] {
  const cli: Hunk[] = [
    {
      hunkId: "b-h1",
      proposalId: "b-p1",
      header: "@@ -1,6 +1,7 @@ imports",
      rationale: "json is needed to serialise the config; `Config` values are not all JSON-native.",
      state: "pending",
      added: 1,
      removed: 0,
      lines: [l("context", "from __future__ import annotations", 1, 1), l("context", "", 2, 2), l("context", "import ast", 3, 3), l("add", "import json", undefined, 4), l("context", "import collections", 4, 5), l("context", "import importlib.metadata", 5, 6)],
    },
    {
      hunkId: "b-h2",
      proposalId: "b-p1",
      header: "@@ -1012,3 +1019,33 @@ def routes_command",
      rationale: "New `config` command mirrors `routes`: registered on FlaskGroup, masks secret-looking keys, falls back to str() for non-JSON values such as timedelta.",
      state: "pending",
      added: 30,
      removed: 0,
      lines: [
        l("context", "    for rule, methods in zip(rules, rule_methods):", 1012, 1019),
        l("context", "        click.echo(row.format(rule.rule, rule.endpoint, methods))", 1013, 1020),
        l("add", "", undefined, 1021),
        l("add", "", undefined, 1022),
        l("add", '_SECRET_MARKERS = ("SECRET", "PASSWORD", "TOKEN", "KEY")', undefined, 1023),
        l("add", "", undefined, 1024),
        l("add", "", undefined, 1025),
        l("add", '@click.command("config", short_help="Show the app configuration.")', undefined, 1026),
        l("add", "@with_appcontext", undefined, 1027),
        l("add", "def config_command() -> None:", undefined, 1028),
        l("add", '    """Print the loaded application\'s configuration as JSON. Values of keys', undefined, 1029),
        l("add", '    containing SECRET, PASSWORD, TOKEN or KEY are masked as "***".', undefined, 1030),
        l("add", '    """', undefined, 1031),
        l("add", "    app = current_app", undefined, 1032),
        l("add", "    masked = {", undefined, 1033),
        l("add", '        key: "***" if any(m in key.upper() for m in _SECRET_MARKERS) else value', undefined, 1034),
        l("add", "        for key, value in app.config.items()", undefined, 1035),
        l("add", "    }", undefined, 1036),
        l("add", "    click.echo(json.dumps(masked, indent=2, sort_keys=True, default=str))", undefined, 1037),
      ],
    },
    {
      hunkId: "b-h3",
      proposalId: "b-p1",
      header: "@@ -1034,2 +1071,3 @@ FlaskGroup registration",
      rationale: "Register the command so it appears in `flask --help`.",
      state: "pending",
      added: 1,
      removed: 0,
      lines: [l("context", "cli.add_command(run_command)", 1034, 1071), l("context", "cli.add_command(shell_command)", 1035, 1072), l("add", "cli.add_command(config_command)", undefined, 1073)],
    },
  ];
  const test: Hunk[] = [
    {
      hunkId: "b-h4",
      proposalId: "b-p2",
      header: "@@ -690,3 +690,22 @@ def test_routes_...",
      rationale: "Covers masking of all four marker substrings and that non-secret keys pass through.",
      state: "pending",
      added: 19,
      removed: 0,
      lines: [
        l("context", "    assert match is not None", 690, 690),
        l("add", "", undefined, 691),
        l("add", "", undefined, 692),
        l("add", "def test_config_command_masks_secrets(runner):", undefined, 693),
        l("add", "    app = Flask(__name__)", undefined, 694),
        l("add", "    app.config.update(", undefined, 695),
        l("add", '        SECRET_KEY="s3cr3t", DB_PASSWORD="pw", API_TOKEN="tok",', undefined, 696),
        l("add", '        STRIPE_KEY="k", GREETING="visible",', undefined, 697),
        l("add", "    )", undefined, 698),
        l("add", "    result = runner.invoke(app.cli, [\"config\"])", undefined, 699),
        l("add", "    assert result.exit_code == 0", undefined, 700),
        l("add", "    data = json.loads(result.output)", undefined, 701),
        l("add", '    for name in ("SECRET_KEY", "DB_PASSWORD", "API_TOKEN", "STRIPE_KEY"):', undefined, 702),
        l("add", '        assert data[name] == "***"', undefined, 703),
        l("add", '    assert data["GREETING"] == "visible"', undefined, 704),
      ],
    },
  ];
  const docs: Hunk[] = [
    {
      hunkId: "b-h5",
      proposalId: "b-p3",
      header: "@@ -48,3 +48,14 @@ Open a Shell",
      rationale: "Documents the command next to `routes` and `shell`.",
      state: "pending",
      added: 11,
      removed: 0,
      lines: [
        l("context", "Open a Shell", 48, 48),
        l("context", "------------", 49, 49),
        l("add", "", undefined, 50),
        l("add", "Show the Configuration", undefined, 51),
        l("add", "----------------------", undefined, 52),
        l("add", "", undefined, 53),
        l("add", "``flask config`` prints the loaded application's configuration as JSON.", undefined, 54),
        l("add", 'Values of keys containing ``SECRET``, ``PASSWORD``, ``TOKEN`` or ``KEY`` are', undefined, 55),
        l("add", 'replaced with ``"***"``.', undefined, 56),
        l("add", "", undefined, 57),
        l("add", ".. code-block:: text", undefined, 58),
        l("add", "    $ flask --app hello config", undefined, 59),
      ],
    },
  ];
  const sum = (hs: Hunk[]) => ({ added: hs.reduce((a, h) => a + h.added, 0), removed: hs.reduce((a, h) => a + h.removed, 0) });
  return [
    { proposalId: "b-p1", path: "src/flask/cli.py", status: "M", ...sum(cli), hunks: cli },
    { proposalId: "b-p2", path: "tests/test_cli.py", status: "M", ...sum(test), hunks: test },
    { proposalId: "b-p3", path: "docs/cli.rst", status: "M", ...sum(docs), hunks: docs },
  ];
}

export const TASK_B_CONTEXT: ContextState = {
  budgetTokens: 24000,
  usedTokens: 14320,
  strategy:
    "Lexical + structural retrieval: ripgrep hits on task terms, Tree-sitter symbols, import graph (depth 2), test-affinity. Ranked, then packed into a 24k budget via a tier ladder Full → Symbols → Skeleton → Path.",
  items: [
    { path: "src/flask/cli.py", tier: "full", tokens: 6240, score: 0.97, source: "get_context", reasons: ["matches 'CLI command' (14 hits)", "defines FlaskGroup, routes_command", "imports click"] },
    { path: "tests/test_cli.py", tier: "symbols", tokens: 2910, score: 0.91, source: "get_context", reasons: ["test-affinity: tests cli.py", "matches 'routes' tests"] },
    { path: "docs/cli.rst", tier: "full", tokens: 2480, score: 0.88, source: "get_context", reasons: ["documents built-in commands", "matches 'flask --help'"] },
    { path: "src/flask/app.py", tier: "skeleton", tokens: 1180, score: 0.62, source: "get_context", reasons: ["imported by cli.py", "defines Flask.config"] },
    { path: "src/flask/config.py", tier: "symbols", tokens: 1010, score: 0.58, source: "get_context", reasons: ["defines Config (dict subclass)", "matches 'configuration'"] },
    { path: "src/flask/helpers.py", tier: "path", tokens: 40, score: 0.21, source: "read_by_agent", reasons: ["imported by cli.py"] },
    { path: "src/flask/__init__.py", tier: "path", tokens: 60, score: 0.18, source: "get_context", reasons: ["re-exports current_app"] },
  ] satisfies ContextItem[],
  excluded: [
    { path: "src/flask/sansio/app.py", reason: "over budget", tokens: 9400 },
    { path: "tests/test_basic.py", reason: "low score", tokens: 21000 },
    { path: "docs/changes.rst", reason: "over budget", tokens: 18200 },
    { path: "requirements/dev.txt", reason: "lockfile" },
    { path: ".env.example", reason: "denied: secret" },
  ],
  searches: [
    { query: "click.command", tool: "search_workspace", matches: 9, at: 0, topPaths: ["src/flask/cli.py"] },
    { query: "routes_command", tool: "find_symbol", matches: 1, at: 0, topPaths: ["src/flask/cli.py"] },
    { query: "flask routes", tool: "search_workspace", matches: 23, at: 0, topPaths: ["tests/test_cli.py", "docs/cli.rst"] },
  ],
};

export function taskBPlan(done: number): PlanStep[] {
  const titles: [string, string[]][] = [
    ["Find where built-in CLI commands are registered", ["src/flask/cli.py"]],
    ["Implement `config` command with secret masking", ["src/flask/cli.py"]],
    ["Add a test covering masking and pass-through", ["tests/test_cli.py"]],
    ["Document the command beside routes and shell", ["docs/cli.rst"]],
    ["Run tests/test_cli.py in the shadow workspace", []],
  ];
  return titles.map(([title, files], i) => ({
    id: String(i + 1),
    title,
    files,
    status: i < done ? "done" : i === done ? "in_progress" : "pending",
    dependsOn: i > 0 && i < 4 ? ["1"] : undefined,
  }));
}
