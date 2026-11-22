import { z } from "zod";
import { MentionSchema, PathSchema, RangeSchema } from "./common.js";

/** Input schemas for every MCP tool exposed by FORGE (architecture.md §B.4). All strict. */
export const ReadFileInput = z.object({ path: PathSchema, range: RangeSchema.optional() }).strict();
export const SearchWorkspaceInput = z
  .object({
    query: z.string().min(1).max(500),
    regex: z.boolean().optional(),
    glob: z.array(z.string().max(200)).max(10).optional(),
    caseSensitive: z.boolean().optional(),
    maxResults: z.number().int().min(1).max(200).optional(),
  })
  .strict();
export const FindSymbolInput = z
  .object({
    name: z.string().min(1).max(256),
    kind: z.enum(["function", "class", "method", "variable", "any"]).optional(),
    includeReferences: z.boolean().optional(),
    path: PathSchema.optional(),
  })
  .strict();
export const GetFileStructureInput = z.object({ path: PathSchema, depth: z.number().int().min(1).max(4).optional() }).strict();
export const GetContextInput = z
  .object({
    query: z.string().min(1).max(4000),
    mentions: z.array(MentionSchema).max(50).optional(),
    budgetTokens: z.number().int().min(500).max(200_000).optional(),
    focusPaths: z.array(PathSchema).max(50).optional(),
  })
  .strict();

export const RangeEditSchema = z.object({ range: RangeSchema, newText: z.string().max(500_000) }).strict();
/** Exact-text replacement: oldText must occur exactly once in the file. Most reliable for weaker models. */
export const ReplaceEditSchema = z.object({ oldText: z.string().min(1).max(200_000), newText: z.string().max(500_000) }).strict();
export const EditSchema = z.union([RangeEditSchema, ReplaceEditSchema]);
export const ProposeEditInput = z
  .object({
    path: PathSchema,
    baseHash: z.string().min(8).max(128).optional(),
    edits: z.array(EditSchema).min(1).max(200).optional(),
    newContent: z.string().max(2_000_000).optional(),
    create: z.boolean().optional(),
    delete: z.boolean().optional(),
    rationale: z.string().min(1).max(2000),
  })
  .strict()
  .refine((v) => [v.edits !== undefined, v.newContent !== undefined, v.delete === true].filter(Boolean).length === 1, {
    message: "Provide exactly one of: edits, newContent, delete:true",
  });
export const SubmitChangesInput = z
  .object({ summary: z.string().min(1).max(4000), proposalIds: z.array(z.string()).max(200).optional() })
  .strict();
export const VerifyChangesInput = z
  .object({
    checklist: z
      .array(z.object({ requirement: z.string().min(3).max(300), evidence: z.string().min(3).max(400) }).strict())
      .min(1)
      .max(20),
  })
  .strict();
export const RunTerminalInput = z
  .object({
    command: z.string().min(1).max(2000),
    cwd: PathSchema.optional(),
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
    reason: z.string().min(1).max(500),
  })
  .strict();
export const GetDiagnosticsInput = z
  .object({ paths: z.array(PathSchema).max(100).optional(), severity: z.enum(["error", "warning", "all"]).optional() })
  .strict();
export const GetGitStatusInput = z.object({ includeDiffStat: z.boolean().optional() }).strict();
export const UpdatePlanInput = z
  .object({
    steps: z
      .array(
        z
          .object({
            id: z.string().min(1).max(40),
            title: z.string().min(1).max(300),
            status: z.enum(["pending", "in_progress", "done", "skipped"]),
            files: z.array(PathSchema).max(30).optional(),
            dependsOn: z.array(z.string().max(40)).max(20).optional(),
          })
          .strict(),
      )
      .max(30),
  })
  .strict()
  .refine((v) => new Set(v.steps.map((s) => s.id)).size === v.steps.length, { message: "duplicate step ids" });

export const TOOL_NAMES = [
  "read_file",
  "search_workspace",
  "find_symbol",
  "get_file_structure",
  "get_context",
  "propose_edit",
  "verify_changes",
  "submit_changes",
  "run_terminal",
  "get_diagnostics",
  "get_git_status",
  "update_plan",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export type ReadFileInput = z.infer<typeof ReadFileInput>;
export type SearchWorkspaceInput = z.infer<typeof SearchWorkspaceInput>;
export type FindSymbolInput = z.infer<typeof FindSymbolInput>;
export type GetFileStructureInput = z.infer<typeof GetFileStructureInput>;
export type GetContextInput = z.infer<typeof GetContextInput>;
export type ProposeEditInput = z.infer<typeof ProposeEditInput>;
export type VerifyChangesInput = z.infer<typeof VerifyChangesInput>;
export type SubmitChangesInput = z.infer<typeof SubmitChangesInput>;
export type RunTerminalInput = z.infer<typeof RunTerminalInput>;
export type GetDiagnosticsInput = z.infer<typeof GetDiagnosticsInput>;
export type GetGitStatusInput = z.infer<typeof GetGitStatusInput>;
export type UpdatePlanInput = z.infer<typeof UpdatePlanInput>;

export interface PlanStep {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done" | "skipped";
  files?: string[] | undefined;
  dependsOn?: string[] | undefined;
}
