#!/usr/bin/env bash
# Runs every automated check that exercises the three fixed Flask 3.1.3 tasks, with a SCRIPTED model standing in for an LLM.
# These prove FORGE's plumbing (TrueForge loop -> MCP tools -> shadow verification -> approval -> apply/undo, cancellation,
# fallback, error handling). They do NOT measure how well a real model solves the tasks: for that, configure a real model in
# TrueForge and run Tasks A/B/C by hand in VS Code (see eval/README.md) and report those results separately.
set -uo pipefail
cd "$(dirname "$0")/.."
eval/setup-flask.sh >/dev/null || { echo "fixture setup failed"; exit 1; }
rc=0
echo "== unit + MCP tests";            npm test --silent                 || rc=1
echo "== live: real TrueForge + Flask"; npm run test:live --silent        || rc=1
echo "== live: real VS Code";           npm run test:vscode --silent 2>&1 | grep -E "^(===|PASS|FAIL|git status|ALL)" ; [ "${PIPESTATUS[0]}" = 0 ] || rc=1
[ $rc = 0 ] && echo "ALL AUTOMATED CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $rc
