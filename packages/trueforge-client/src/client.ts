import { TrueForge } from "@truefoundry/trueforge-sdk";
import { classifyThrown } from "./classify.js";
import type { ErrorClass } from "@forge/protocol";

export interface ProbeOk {
  ok: true;
  baseUrl: string;
  latencyMs: number;
  sandbox: boolean;
}
export interface ProbeFail {
  ok: false;
  baseUrl: string;
  errorClass: ErrorClass;
  message: string;
}

export interface ModelInfo {
  name: string;
  provider: string;
  contextLength?: number | undefined;
  maxOutputTokens?: number | undefined;
}

export interface AgentSpec {
  model: { name: string; params?: Record<string, unknown> };
  instructions?: string;
  mcp_servers?: { name: string; enable_tools?: string[]; disable_tools?: string[]; preload_tools?: string[]; require_approval_for_tools?: string[]; preload?: boolean }[];
  config?: Record<string, unknown>;
  [k: string]: unknown;
}

/** Thin, typed access to a TrueForge server. QuantForge never talks to a model provider; this is the only egress. */
export class TrueForgeApi {
  readonly sdk: TrueForge;
  constructor(readonly baseUrl: string, opts: { token?: string; timeoutInSeconds?: number } = {}) {
    if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(baseUrl) && !opts.token) {
      // Non-loopback servers are only used in hosted mode with login; refuse silently-insecure setups.
      throw new Error(`Refusing to use non-loopback TrueForge URL without a token: ${baseUrl}`);
    }
    this.sdk = new TrueForge({ baseUrl, timeoutInSeconds: opts.timeoutInSeconds ?? 60, ...(opts.token ? { token: opts.token } : {}) });
  }

  /** Cheap reachability check using the documented capabilities endpoint. */
  async probe(timeoutMs = 3000): Promise<ProbeOk | ProbeFail> {
    const t0 = Date.now();
    try {
      const r = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/v1/capabilities`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) return { ok: false, baseUrl: this.baseUrl, errorClass: "TRUEFORGE_UNREACHABLE", message: `TrueForge answered HTTP ${r.status}` };
      const j = (await r.json()) as { data?: { sandbox?: { enabled?: boolean } } };
      return { ok: true, baseUrl: this.baseUrl, latencyMs: Date.now() - t0, sandbox: j.data?.sandbox?.enabled === true };
    } catch (e) {
      const c = classifyThrown(e);
      return { ok: false, baseUrl: this.baseUrl, errorClass: c.errorClass, message: c.title };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const r = await this.sdk.models.list();
    return (r.data as unknown as { name: string; provider: { name: string }; properties?: { contextLength?: number; maxOutputTokens?: number } }[]).map((m) => ({ name: m.name, provider: m.provider.name, contextLength: m.properties?.contextLength, maxOutputTokens: m.properties?.maxOutputTokens }));
  }

  /** Register (or update) QuantForge's loopback MCP server in TrueForge via its settings API. */
  async upsertMcpServer(o: { name: string; url: string; token: string; description?: string }): Promise<void> {
    const manifest = { type: "remote", name: o.name, description: o.description ?? "QuantForge editor tools", url: o.url, auth: { type: "header", headers: { Authorization: `Bearer ${o.token}` } } };
    const base = this.baseUrl.replace(/\/$/, "");
    const headers = { "content-type": "application/json" };
    let r = await fetch(`${base}/api/v1/settings/mcp-servers`, { method: "POST", headers, body: JSON.stringify({ manifest }) });
    if (r.status === 409 || r.status === 400) r = await fetch(`${base}/api/v1/settings/mcp-servers`, { method: "PUT", headers, body: JSON.stringify({ manifest }) });
    if (!r.ok) {
      const body = await r.text();
      const hint = /Outbound URL blocked/.test(body)
        ? ' TrueForge blocks loopback URLs by default; start it with OUTBOUND_URL_ALLOWED_HOSTS=\'["127.0.0.1"]\' (the "QuantForge: Start TrueForge" command does this).'
        : "";
      throw new Error(`could not register MCP server "${o.name}" (HTTP ${r.status}): ${body.slice(0, 200)}.${hint}`);
    }
  }

  async createSession(spec: AgentSpec): Promise<string> {
    const { data } = await this.sdk.sessions.create({ agent: { spec } } as never);
    return (data as { id: string }).id;
  }

  async cancel(sessionId: string): Promise<void> {
    await this.sdk.sessions.cancel(sessionId);
  }
}
