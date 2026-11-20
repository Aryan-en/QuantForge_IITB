/**
 * Eligibility guard (FORGE-015): FORGE code must never call a model provider directly — all model access goes
 * through TrueForge. Fails CI if a provider SDK is imported/declared or a provider API host appears in shipped source.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const FORBIDDEN_PKGS = ["openai", "@anthropic-ai/sdk", "@google/genai", "@google/generative-ai", "cohere-ai", "@mistralai/mistralai", "groq-sdk", "ollama", "@ai-sdk/openai", "@ai-sdk/anthropic", "@ai-sdk/google", "@aws-sdk/client-bedrock-runtime", "langchain", "@langchain/core"];
const FORBIDDEN_HOSTS = /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.mistral\.ai|api\.cohere\.(ai|com)|api\.groq\.com|openrouter\.ai|api\.together\.xyz|api\.fireworks\.ai|bedrock-runtime|api\.x\.ai/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (["node_modules", "dist", "work", ".git"].includes(e)) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(p)) out.push(p);
  }
  return out;
}
const shipped = (f: string): boolean => !/[\\/](test|testing)[\\/]/.test(f);

describe("no direct model-provider access (TrueForge owns every model call)", () => {
  const files = walk(path.join(ROOT, "packages")).filter(shipped);
  it("scans a meaningful amount of source", () => expect(files.length).toBeGreaterThan(30));
  it("imports no provider SDK", () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const pkg of FORBIDDEN_PKGS) if (new RegExp(`(from\\s+|require\\()\\s*["']${pkg.replace("/", "\\/")}(/[^"']*)?["']`).test(src)) bad.push(`${path.relative(ROOT, f)} imports ${pkg}`);
    }
    expect(bad).toEqual([]);
  });
  it("mentions no provider API host in shipped source", () => {
    const bad = files.filter((f) => FORBIDDEN_HOSTS.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(bad).toEqual([]);
  });
  it("declares no provider SDK in any package.json", () => {
    const bad: string[] = [];
    for (const pkgDir of readdirSync(path.join(ROOT, "packages"))) {
      const j = JSON.parse(readFileSync(path.join(ROOT, "packages", pkgDir, "package.json"), "utf8")) as Record<string, Record<string, string>>;
      for (const dep of Object.keys({ ...j.dependencies, ...j.devDependencies })) if (FORBIDDEN_PKGS.includes(dep)) bad.push(`${pkgDir}: ${dep}`);
    }
    expect(bad).toEqual([]);
  });
  it("the only network client in the extension is the TrueForge SDK / loopback MCP", () => {
    const fetchers = files.filter((f) => /\bfetch\(/.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(fetchers.sort()).toEqual(["packages/trueforge-client/src/client.ts"]);
  });
});
