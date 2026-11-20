import {
  Braces,
  FileText,
  FolderTree,
  GitBranch,
  GitCompare,
  Layers,
  ListChecks,
  Search,
  ShieldCheck,
  Terminal,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { ToolName } from "@/lib/protocol";

/** Fixed icon mapping (Ui-regitry §B.5). */
export const TOOL_ICON: Record<ToolName, LucideIcon> = {
  read_file: FileText,
  search_workspace: Search,
  find_symbol: Braces,
  get_file_structure: FolderTree,
  get_context: Layers,
  propose_edit: GitCompare,
  submit_changes: ShieldCheck,
  run_terminal: Terminal,
  get_diagnostics: TriangleAlert,
  get_git_status: GitBranch,
  update_plan: ListChecks,
};

export const TOOL_VERB: Record<ToolName, string> = {
  read_file: "Read",
  search_workspace: "Searched",
  find_symbol: "Found symbol",
  get_file_structure: "Outlined",
  get_context: "Assembled context",
  propose_edit: "Proposed edit",
  submit_changes: "Review gate",
  run_terminal: "Ran",
  get_diagnostics: "Diagnostics",
  get_git_status: "Git status",
  update_plan: "Updated plan",
};
