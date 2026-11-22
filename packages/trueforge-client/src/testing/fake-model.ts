/**
 * A scripted, deterministic OpenAI-compatible chat-completions server.
 *
 * PURPOSE: exercise QuantForge ↔ TrueForge ↔ MCP end-to-end in CI and the evaluation harness without a paid model, and
 * inject provider failures (401/429/500/hang/drop) for resilience tests. It is a test fixture. It says nothing about
 * how well a real model performs; real-model results must be reported separately.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | { type: string; text?: string }[] | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: { type: "function"; function: { name: string; description?: string; parameters?: unknown } }[];
  stream?: boolean;
}

export type Reply =
  | { type: "text"; text: string; chunkSize?: number; delayMs?: number }
  | { type: "tool_calls"; calls: { name: string; args: Record<string, unknown> }[]; text?: string }
  | { type: "error"; status: number; message?: string }
  | { type: "hang" }
  | { type: "drop" };

export type Policy = (req: ChatRequest, callIndex: number) => Reply | Promise<Reply>;

export interface FakeModelServer {
  url: string;
  baseUrl: string;
  requests: ChatRequest[];
  close(): Promise<void>;
}

const sse = (o: unknown): string => `data: ${JSON.stringify(o)}\n\n`;

export async function startFakeModel(policy: Policy, opts: { port?: number } = {}): Promise<FakeModelServer> {
  const requests: ChatRequest[] = [];
  const open = new Set<http.ServerResponse>();
  const server = http.createServer(async (req, res) => {
    open.add(res);
    res.on("close", () => open.delete(res));
    if (req.method === "GET" && /\/models\/?$/.test(req.url ?? "")) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: [{ id: "fake-model", object: "model" }] }));
      return;
    }
    if (req.method !== "POST" || !/\/chat\/completions\/?$/.test(req.url ?? "")) {
      res.writeHead(404).end("not found");
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ChatRequest;
    const index = requests.push(body) - 1;
    let reply: Reply;
    try {
      reply = await policy(body, index);
    } catch (e) {
      reply = { type: "error", status: 500, message: (e as Error).message };
    }
    const id = `chatcmpl-${index}`;
    const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: body.model };
    if (reply.type === "error") {
      res.writeHead(reply.status, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: reply.message ?? `fake error ${reply.status}`, type: reply.status === 401 ? "invalid_request_error" : "server_error", code: reply.status === 401 ? "invalid_api_key" : null } }));
      return;
    }
    if (reply.type === "drop") return void req.socket.destroy();
    if (reply.type === "hang") return; // never answer; TrueForge's own timeout/cancel must cope
    if (!body.stream) {
      const message = reply.type === "text" ? { role: "assistant", content: reply.text } : { role: "assistant", content: reply.text ?? null, tool_calls: reply.calls.map((c, i) => ({ id: `call_${index}_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message, finish_reason: reply.type === "text" ? "stop" : "tool_calls" }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(sse({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }));
    if (reply.type === "text") {
      const size = reply.chunkSize ?? 12;
      for (let i = 0; i < reply.text.length; i += size) {
        if (res.destroyed) return;
        res.write(sse({ ...base, choices: [{ index: 0, delta: { content: reply.text.slice(i, i + size) }, finish_reason: null }] }));
        if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
      }
      res.write(sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }));
    } else {
      if (reply.text) res.write(sse({ ...base, choices: [{ index: 0, delta: { content: reply.text }, finish_reason: null }] }));
      reply.calls.forEach((c, i) => {
        res.write(sse({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: `call_${index}_${i}`, type: "function", function: { name: c.name, arguments: "" } }] }, finish_reason: null }] }));
        res.write(sse({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: i, function: { arguments: JSON.stringify(c.args) } }] }, finish_reason: null }] }));
      });
      res.write(sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }));
    }
    res.write(sse({ ...base, choices: [], usage: { prompt_tokens: 100 + index * 10, completion_tokens: 20, total_tokens: 120 + index * 10 } }));
    res.write("data: [DONE]\n\n");
    res.end();
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((r) => {
      for (const s of open) s.destroy();
      server.closeAllConnections();
      server.close(() => r());
    }),
  };
}

/** Plain text of a message's content. */
export function textOf(m: ChatMessage): string {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) return m.content.map((p) => p.text ?? "").join("");
  return "";
}
