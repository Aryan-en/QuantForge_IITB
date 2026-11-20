import { z } from "zod";

/** Workspace-relative POSIX path. Validation of containment happens in editor-mcp's resolveWorkspacePath. */
export const PathSchema = z.string().min(1).max(1024);
export type Path = z.infer<typeof PathSchema>;

/** 1-based inclusive line range. */
export const RangeSchema = z
  .object({ startLine: z.number().int().min(1), endLine: z.number().int().min(1) })
  .strict()
  .refine((r) => r.endLine >= r.startLine, { message: "endLine must be >= startLine" });
export type Range = z.infer<typeof RangeSchema>;

export const TOOL_ERROR_CODES = [
  "PATH_OUTSIDE_WORKSPACE",
  "NOT_FOUND",
  "DENIED",
  "TOO_LARGE",
  "TIMEOUT",
  "CANCELLED",
  "INVALID_INPUT",
  "STALE_BASE",
  "INTERNAL",
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  hint?: string;
}
export type ToolFailure = { ok: false; error: ToolError };
export type ToolSuccess<T> = { ok: true } & T;
export type ToolResult<T> = ToolSuccess<T> | ToolFailure;

export const MentionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: PathSchema }).strict(),
  z.object({ kind: z.literal("symbol"), name: z.string().min(1).max(256), path: PathSchema.optional() }).strict(),
]);
export type Mention = z.infer<typeof MentionSchema>;

export function fail(code: ToolErrorCode, message: string, hint?: string): ToolFailure {
  return { ok: false, error: hint === undefined ? { code, message } : { code, message, hint } };
}
