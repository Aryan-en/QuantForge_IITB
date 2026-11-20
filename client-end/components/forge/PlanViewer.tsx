import { Circle, CircleCheck, CircleMinus, FileText, ListChecks } from "lucide-react";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/misc";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import { basename } from "@/lib/format";
import type { PlanStep as Step } from "@/lib/protocol";

const STATUS_TEXT: Record<Step["status"], string> = { pending: "Pending", in_progress: "In progress", done: "Done", skipped: "Skipped" };

export function PlanStep({ step, index, onOpenFile }: { step: Step; index: number; onOpenFile: (path: string) => void }) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <span aria-hidden className="absolute left-[9px] top-5 h-[calc(100%-16px)] w-px bg-border last:hidden" />
      <span className="relative z-[1] mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-bg">
        {step.status === "done" ? (
          <CircleCheck size={16} className="text-success" aria-hidden />
        ) : step.status === "in_progress" ? (
          <span className="text-accent">
            <Spinner size={15} />
          </span>
        ) : step.status === "skipped" ? (
          <CircleMinus size={16} className="text-faint" aria-hidden />
        ) : (
          <Circle size={16} className="text-faint" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-body", step.status === "done" ? "text-muted" : step.status === "in_progress" ? "font-medium text-fg" : "text-fg", step.status === "skipped" && "line-through")}>
          <span className="tabular mr-1.5 text-faint">{index + 1}.</span>
          {step.title}
          <span className="sr-only"> — {STATUS_TEXT[step.status]}</span>
        </p>
        {step.files?.length || step.dependsOn?.length ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {step.files?.map((f) => (
              <button key={f} type="button" onClick={() => onOpenFile(f)} className="rounded-sm" title={f}>
                <Chip icon={FileText} mono>
                  {basename(f)}
                </Chip>
              </button>
            ))}
            {step.dependsOn?.map((d) => (
              <Chip key={d}>after step {d}</Chip>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function PlanViewer({ steps, ignoredInvalid, onOpenFile }: { steps: Step[]; ignoredInvalid: boolean; onOpenFile: (path: string) => void }) {
  if (steps.length === 0) {
    return <EmptyState icon={ListChecks} title="No plan yet" body="Agents plan non-trivial tasks before editing. The plan comes from the agent's update_plan tool." />;
  }
  const done = steps.filter((s) => s.status === "done").length;
  return (
    <div className="p-3">
      <div className="mb-3 flex items-center gap-2">
        <ListChecks size={14} className="text-muted" aria-hidden />
        <span className="text-secondary text-muted">From update_plan</span>
        <span className="tabular ml-auto text-secondary text-fg">
          {done}/{steps.length} done
        </span>
      </div>
      <ol aria-label="Agent plan">
        {steps.map((s, i) => (
          <PlanStep key={s.id} step={s} index={i} onOpenFile={onOpenFile} />
        ))}
      </ol>
      {ignoredInvalid ? <p className="mt-3 text-meta text-faint">Plan update ignored (invalid).</p> : null}
    </div>
  );
}
