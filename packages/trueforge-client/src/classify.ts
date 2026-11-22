import type { ErrorClass } from "@forge/protocol";

export interface Classified {
  errorClass: ErrorClass;
  retryable: boolean;
  /** Max automatic attempts (including the first) for this class before moving to the next model. */
  maxAttempts: number;
  title: string;
  hint: string;
}

/**
 * Maps real TrueForge failure messages (captured from a live local-mode server) to QuantForge error classes.
 *   turn.done {status:"error", message:"[Model Error] Request failed (401): …"}
 *   turn.done {status:"error", message:"[Model Error] Cannot connect to API: bad port"}
 *   SDK/fetch failures talking to TrueForge itself (ECONNREFUSED, timeout) ⇒ TRUEFORGE_UNREACHABLE
 */
export function classifyMessage(message: string): Classified {
  const m = /Request failed \((\d{3})\)/.exec(message);
  if (m) {
    const code = Number(m[1]);
    if (code === 401 || code === 403) return { errorClass: "MODEL_AUTH", retryable: false, maxAttempts: 1, title: "Model rejected the API key", hint: "Fix the key in TrueForge → Settings → Models, or configure a fallback model." };
    if (code === 429 || code === 408) return { errorClass: "MODEL_RATE_LIMIT", retryable: true, maxAttempts: 2, title: "Model is rate-limiting requests", hint: "Retrying with backoff; a fallback model will take over if it persists." };
    if (code >= 500) return { errorClass: "MODEL_UNAVAILABLE", retryable: true, maxAttempts: 2, title: "Model provider returned a server error", hint: "Usually transient; retrying, then falling back." };
    if (code === 404) return { errorClass: "MODEL_UNAVAILABLE", retryable: false, maxAttempts: 1, title: "Model or endpoint not found", hint: "Check the model id and base URL configured in TrueForge." };
    return { errorClass: "UNKNOWN", retryable: false, maxAttempts: 1, title: `Model request failed (${code})`, hint: "See details." };
  }
  if (/Cannot connect to API|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|other side closed|socket hang up|ETIMEDOUT/i.test(message)) {
    return { errorClass: "MODEL_UNAVAILABLE", retryable: true, maxAttempts: 2, title: "Cannot reach the model endpoint", hint: "Check the endpoint/base URL in TrueForge → Settings → Models, or configure a fallback model. For a slow local model, start TrueForge with MODEL_HTTP_HEADERS_TIMEOUT_MS=300000 (its default is 20 s)." };
  }
  if (/stalled|no events? for/i.test(message)) return { errorClass: "STALLED", retryable: true, maxAttempts: 2, title: "The model stopped responding", hint: "Retrying; a fallback model will take over if it persists." };
  return { errorClass: "UNKNOWN", retryable: false, maxAttempts: 1, title: "The agent run failed", hint: message.slice(0, 300) };
}

/** Errors thrown by the SDK while talking to TrueForge itself. */
export function classifyThrown(e: unknown): Classified {
  const err = e as { name?: string; cause?: { code?: string; message?: string } };
  const msg = e instanceof Error ? `${e.message} ${err.cause?.code ?? ""} ${err.cause?.message ?? ""}` : String(e);
  // A TIMEOUT means the server accepted the connection but did not answer in time (slow local model, long prompt): it is alive.
  if (err.name === "TrueForgeTimeoutError" || /timed out|timeout|UND_ERR_(HEADERS|BODY)_TIMEOUT/i.test(msg) && !/ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(msg)) {
    return { errorClass: "STALLED", retryable: true, maxAttempts: 2, title: "TrueForge did not answer in time", hint: "TrueForge is running but the model is slow. For local models raise forge.stallTimeoutMs and start TrueForge with MODEL_HTTP_HEADERS_TIMEOUT_MS=300000." };
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|ECONNRESET|network|socket|UND_ERR/i.test(msg)) {
    return { errorClass: "TRUEFORGE_UNREACHABLE", retryable: false, maxAttempts: 1, title: "TrueForge is not reachable", hint: "Start it with “QuantForge: Start TrueForge” (npx @truefoundry/trueforge@latest) and check forge.trueforge.baseUrl." };
  }
  if (/\b401\b|\b403\b|unauthor/i.test(msg)) return { errorClass: "TRUEFORGE_UNREACHABLE", retryable: false, maxAttempts: 1, title: "TrueForge rejected the request", hint: "TrueForge may require login (hosted mode); local mode needs none." };
  return { errorClass: "UNKNOWN", retryable: false, maxAttempts: 1, title: "Unexpected error talking to TrueForge", hint: msg.slice(0, 300) };
}

/** Exponential backoff with full jitter: random(0, min(cap, base·2^attempt)). */
export function backoffDelayMs(attempt: number, rng: () => number = Math.random, baseMs = 500, capMs = 8000): number {
  return Math.floor(rng() * Math.min(capMs, baseMs * 2 ** attempt));
}
