import { describe, it, expect } from "vitest";
import { classifyMessage, classifyThrown, backoffDelayMs } from "../src/index.js";

// Messages below are the REAL payloads captured from TrueForge local mode (turn.done state.message).
describe("classifyMessage — real TrueForge failure payloads", () => {
  const cases: [string, string, boolean, number][] = [
    ["[Model Error] Request failed (401): Incorrect API key provided", "MODEL_AUTH", false, 1],
    ["[Model Error] Request failed (403): forbidden", "MODEL_AUTH", false, 1],
    ["[Model Error] Request failed (429): Rate limit reached", "MODEL_RATE_LIMIT", true, 2],
    ["[Model Error] Request failed (500): upstream exploded", "MODEL_UNAVAILABLE", true, 2],
    ["[Model Error] Request failed (503): overloaded", "MODEL_UNAVAILABLE", true, 2],
    ["[Model Error] Request failed (404): model not found", "MODEL_UNAVAILABLE", false, 1],
    ["[Model Error] Cannot connect to API: bad port", "MODEL_UNAVAILABLE", true, 2],
    ["[Model Error] Cannot connect to API: other side closed", "MODEL_UNAVAILABLE", true, 2],
    ["no events for 45000 ms (stalled)", "STALLED", true, 2],
    ["something nobody anticipated", "UNKNOWN", false, 1],
  ];
  for (const [msg, cls, retry, attempts] of cases) it(`${cls} ← ${msg.slice(0, 55)}`, () => {
    expect(classifyMessage(msg)).toMatchObject({ errorClass: cls, retryable: retry, maxAttempts: attempts });
  });
  it("never retries an auth failure (a retry cannot fix a bad key)", () => expect(classifyMessage("Request failed (401): x").retryable).toBe(false));
});

describe("classifyThrown — failures talking to TrueForge itself", () => {
  const withCause = (m: string, code: string): Error => Object.assign(new Error(m), { cause: { code } });
  it("connection refused / DNS / reset → unreachable (no fallback model can help)", () => {
    for (const e of [withCause("fetch failed", "ECONNREFUSED"), new Error("getaddrinfo ENOTFOUND host"), withCause("fetch failed", "ECONNRESET")]) expect(classifyThrown(e).errorClass).toBe("TRUEFORGE_UNREACHABLE");
  });
  it("a TIMEOUT means TrueForge is alive but slow — NOT 'unreachable' (regression: it used to say so after a 10-minute local-model stall)", () => {
    const t = Object.assign(new Error("Timeout exceeded when executing 'POST' request"), { name: "TrueForgeTimeoutError" });
    expect(classifyThrown(t)).toMatchObject({ errorClass: "STALLED", retryable: true });
    expect(classifyThrown(new Error("UND_ERR_HEADERS_TIMEOUT"))).toMatchObject({ errorClass: "STALLED" });
    expect(classifyThrown(t).hint).toMatch(/MODEL_HTTP_HEADERS_TIMEOUT_MS/);
  });
  it("a connect timeout to a dead host still counts as unreachable", () => {
    expect(classifyThrown(withCause("fetch failed: connect timed out", "ECONNREFUSED")).errorClass).toBe("TRUEFORGE_UNREACHABLE");
  });
});

describe("backoffDelayMs — full jitter, capped", () => {
  it("is within [0, min(8000, 500·2^attempt)) and monotone in its ceiling", () => {
    for (let a = 0; a < 8; a++) { const max = Math.min(8000, 500 * 2 ** a); expect(backoffDelayMs(a, () => 0.999)).toBeLessThanOrEqual(max); expect(backoffDelayMs(a, () => 0)).toBe(0); }
    expect(backoffDelayMs(10, () => 0.9999)).toBeLessThanOrEqual(8000);
  });
});
