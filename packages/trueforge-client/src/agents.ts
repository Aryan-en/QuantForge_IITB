import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentSpec } from "./client.js";

export interface LoadedAgent {
  name: string;
  /** Spec ready to send, with `model.name` still as in the file unless overridden. */
  spec: AgentSpec;
}

/**
 * Load a FORGE agent definition from `agents/<name>.json` (+ `<name>.instructions.md`).
 * `x-*` keys are FORGE metadata and are stripped before the spec is sent to TrueForge.
 */
export async function loadAgent(agentsDir: string, name: "forge-agent" | "forge-inline-edit", opts: { model: string; mcpServerName?: string }): Promise<LoadedAgent> {
  const raw = JSON.parse(await fs.readFile(path.join(agentsDir, `${name}.json`), "utf8")) as Record<string, unknown>;
  const instructions = await fs.readFile(path.join(agentsDir, `${name}.instructions.md`), "utf8");
  const spec = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("x-"))) as AgentSpec;
  spec.instructions = instructions;
  spec.model = { ...(spec.model ?? { name: "" }), name: opts.model };
  if (opts.mcpServerName) spec.mcp_servers = spec.mcp_servers?.map((s) => (s.name === "forge-editor" ? { ...s, name: opts.mcpServerName! } : s));
  return { name, spec };
}

export function withModel(spec: AgentSpec, model: string): AgentSpec {
  return { ...spec, model: { ...spec.model, name: model } };
}
