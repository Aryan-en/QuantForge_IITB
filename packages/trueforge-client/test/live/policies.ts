import type { ChatRequest, Reply } from "../../src/testing/fake-model.js";
import { textOf } from "../../src/testing/fake-model.js";

export const TASK_A = "Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.";
export const TASK_B = "Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as \"***\". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.";

export const toolResults = (req: ChatRequest): { name: string; json: any }[] => {
  const idToName = new Map<string, string>();
  for (const m of req.messages) for (const c of m.tool_calls ?? []) idToName.set(c.id, c.function.name);
  return req.messages.filter((m) => m.role === "tool").map((m) => {
    let json: any = null;
    try { json = JSON.parse(textOf(m)); } catch { /* not json */ }
    return { name: idToName.get(m.tool_call_id ?? "") ?? "?", json };
  });
};

/** What a competent model would do for Task A, scripted. Reads real file content from tool results to build exact edits. */
export function taskAPolicy(req: ChatRequest): Reply {
  const res = toolResults(req);
  const n = res.length;
  if (n === 0) return { type: "tool_calls", calls: [{ name: "read_file", args: { path: "src/flask/helpers.py", range: { startLine: 25, endLine: 40 } } }] };
  if (n === 1) {
    const read = res[0]!.json;
    const edit = {
      oldText: [
        '    """Get whether debug mode should be enabled for the app, indicated by the',
        "    :envvar:`FLASK_DEBUG` environment variable. The default is ``False``.",
        '    """',
        '    val = os.environ.get("FLASK_DEBUG")',
        '    return bool(val and val.lower() not in {"0", "false", "no"})',
      ].join("\n"),
      newText: [
        '    """Get whether debug mode should be enabled for the app, indicated by the',
        "    :envvar:`FLASK_DEBUG` environment variable. The default is ``False``.",
        "",
        '    The values ``0``, ``false``, ``no``, ``off`` and ``n`` (case-insensitive) are',
        "    treated as false; any other non-empty value enables debug mode.",
        '    """',
        '    val = os.environ.get("FLASK_DEBUG")',
        '    return bool(val and val.lower() not in {"0", "false", "no", "off", "n"})',
      ].join("\n"),
    };
    return { type: "tool_calls", calls: [{ name: "propose_edit", args: { path: "src/flask/helpers.py", baseHash: read.contentHash, edits: [edit], rationale: "Treat 'off' and 'n' as false (case-insensitive) and list all false values in the docstring." } }] };
  }
  if (n === 2) return { type: "tool_calls", calls: [{ name: "submit_changes", args: { summary: "get_debug_flag now treats off and n as false; docstring lists every false value." } }] };
  return { type: "text", text: "Updated get_debug_flag in src/flask/helpers.py: 'off' and 'n' are now false (case-insensitive) and the docstring lists all false values. " };
}

const CONFIG_CMD = `_SENSITIVE_CONFIG_PARTS = ("SECRET", "PASSWORD", "TOKEN", "KEY")


@click.command("config", short_help="Show the app configuration as JSON.")
@with_appcontext
def config_command() -> None:
    """Show the loaded application's configuration as JSON. Values of keys
    containing SECRET, PASSWORD, TOKEN or KEY are masked as "***".
    """
    masked = {
        key: (
            "***"
            if any(part in str(key).upper() for part in _SENSITIVE_CONFIG_PARTS)
            else value
        )
        for key, value in current_app.config.items()
    }
    click.echo(json.dumps(masked, indent=2, sort_keys=True, default=str))


cli = FlaskGroup(`;

const CONFIG_TEST = `    assert ctx.params["exclude_patterns"] == [__file__]


def test_config_command_masks_sensitive_values():
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY="s3cret",
        DB_PASSWORD="hunter2",
        API_TOKEN="tok",
        STRIPE_KEY="k",
        GREETING="hello",
    )
    cli = FlaskGroup(create_app=lambda: app)
    result = CliRunner().invoke(cli, ["config"])
    assert result.exit_code == 0
    data = json.loads(result.output)
    for key in ("SECRET_KEY", "DB_PASSWORD", "API_TOKEN", "STRIPE_KEY"):
        assert data[key] == "***"
    assert data["GREETING"] == "hello"
    assert "s3cret" not in result.output
    assert "config" in CliRunner().invoke(cli, ["--help"]).output
`;

const DOCS = `Use :meth:\`~Flask.shell_context_processor\` to add other automatic imports.


Show the Configuration
----------------------

To inspect the configuration the app was loaded with, use the \`\`flask config\`\`
command. It prints the config as JSON. Values of any key containing \`\`SECRET\`\`,
\`\`PASSWORD\`\`, \`\`TOKEN\`\` or \`\`KEY\`\` are masked as \`\`"***"\`\`. ::

    $ flask --app hello config
    {
      "DEBUG": false,
      "SECRET_KEY": "***"
    }
`;

/** Task B as a competent model would do it: discover → plan → three files → verify in shadow → submit. */
export function taskBPolicy(req: ChatRequest): Reply {
  const res = toolResults(req);
  const n = res.length;
  const hash = (name: string, path: string): string | undefined => res.find((r) => r.name === name && r.json?.path === path)?.json?.contentHash;
  switch (n) {
    case 0: return { type: "tool_calls", calls: [{ name: "get_context", args: { query: TASK_B, budgetTokens: 12000 } }] };
    case 1: return { type: "tool_calls", calls: [{ name: "update_plan", args: { steps: [{ id: "1", title: "Find CLI module, tests and docs", status: "done" }, { id: "2", title: "Add config command", status: "in_progress" }, { id: "3", title: "Add test and docs", status: "pending" }, { id: "4", title: "Run tests", status: "pending" }] } }] };
    case 2: return { type: "tool_calls", calls: [{ name: "read_file", args: { path: "src/flask/cli.py", range: { startLine: 1, endLine: 30 } } }, { name: "read_file", args: { path: "tests/test_cli.py", range: { startLine: 1, endLine: 20 } } }, { name: "read_file", args: { path: "docs/cli.rst", range: { startLine: 125, endLine: 150 } } }] };
    case 5: return { type: "tool_calls", calls: [{ name: "propose_edit", args: { path: "src/flask/cli.py", baseHash: hash("read_file", "src/flask/cli.py"), rationale: "Add the built-in `config` command and register it with FlaskGroup.", edits: [
      { oldText: "import inspect\nimport os\n", newText: "import inspect\nimport json\nimport os\n" },
      { oldText: "            self.add_command(routes_command)\n", newText: "            self.add_command(routes_command)\n            self.add_command(config_command)\n" },
      { oldText: "cli = FlaskGroup(", newText: CONFIG_CMD },
    ] } }] };
    case 6: return { type: "tool_calls", calls: [{ name: "propose_edit", args: { path: "tests/test_cli.py", baseHash: hash("read_file", "tests/test_cli.py"), rationale: "Cover the config command and its masking.", edits: [
      { oldText: "import importlib.metadata\nimport os\n", newText: "import importlib.metadata\nimport json\nimport os\n" },
      { oldText: '    assert ctx.params["exclude_patterns"] == [__file__]\n', newText: CONFIG_TEST },
    ] } }] };
    case 7: return { type: "tool_calls", calls: [{ name: "propose_edit", args: { path: "docs/cli.rst", baseHash: hash("read_file", "docs/cli.rst"), rationale: "Document the config command next to the other built-in commands.", edits: [{ oldText: "Use :meth:`~Flask.shell_context_processor` to add other automatic imports.\n", newText: DOCS }] } }] };
    case 8: return { type: "tool_calls", calls: [{ name: "run_terminal", args: { command: "pytest tests/test_cli.py -q -p no:cacheprovider", reason: "verify the new command and its test against the proposed edits" } }] };
    case 9: return { type: "tool_calls", calls: [{ name: "submit_changes", args: { summary: "Add `flask config` (masked JSON), a test, and docs." } }] };
    default: return n < 5 ? { type: "tool_calls", calls: [{ name: "get_context", args: { query: "continue" } }] } : { type: "text", text: "Added the `flask config` built-in command (src/flask/cli.py), a test (tests/test_cli.py) and docs (docs/cli.rst). pytest tests/test_cli.py passes against the proposed edits." };
  }
}
