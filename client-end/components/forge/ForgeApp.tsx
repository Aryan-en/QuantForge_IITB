"use client";

import { Activity, Bot, GitCompare, Layers, ListChecks } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/Chip";
import { EmptyState, Kbd } from "@/components/ui/misc";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/Tabs";
import { cn } from "@/lib/cn";
import { useForge } from "@/lib/host/ForgeProvider";
import { useElementWidth } from "@/lib/hooks";
import { isTurnActive, reviewStats } from "@/lib/store/reducer";
import { ErrorBanner, FallbackBanner, RetryBanner, Toast } from "./Banners";
import { Composer, type MentionCandidate } from "./Composer";
import { ContextInspector } from "./ContextInspector";
import { MessageList } from "./Conversation";
import { DiffReview } from "./DiffReview";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { Header } from "./Header";
import { ModelConfigPanel, SettingsPanel, Welcome } from "./Panels";
import { PlanViewer } from "./PlanViewer";
import { StatusStrip } from "./StatusStrip";

type TabId = "agent" | "context" | "plan" | "review" | "timeline";
type View = "main" | "model" | "settings";

const WIDE = 700;

/**
 * AppShell (Ui-regitry §C.2 / E.2). Narrow: header · tabs · body · status · composer.
 * Wide (≥ 700 px, editor-area panel): conversation left, Context/Plan/Review/Timeline right.
 */
export function ForgeApp({ mentionSource = [], forceWelcome }: { mentionSource?: MentionCandidate[]; forceWelcome?: boolean }) {
  const { state, actions } = useForge();
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef);
  const wide = width >= WIDE;
  const narrow = width > 0 && width < 360;

  const [view, setView] = useState<View>("main");
  const [tab, setTab] = useState<TabId>("agent");
  const [sideTab, setSideTab] = useState<Exclude<TabId, "agent">>("context");
  const [announcement, setAnnouncement] = useState("");

  const { app, review } = state;
  const turn = app.turn;
  const running = isTurnActive(turn.status);
  const stats = reviewStats(review);
  const reviewBadge = stats.pending + stats.accepted;

  // Auto-open Review when the turn pauses on the Review Gate (forge.review.autoOpenOnPause).
  const gate = review.gateCallId;
  const autoOpen = app.settings["review.autoOpenOnPause"];
  const [lastGate, setLastGate] = useState<string | undefined>(undefined);
  if (gate !== lastGate) {
    setLastGate(gate);
    if (gate && autoOpen) {
      setTab("review");
      setSideTab("review");
    }
  }

  // Single polite live region for state changes (Ui-regitry §F screen readers).
  const [lastStatus, setLastStatus] = useState(turn.status);
  if (turn.status !== lastStatus) {
    setLastStatus(turn.status);
    const text =
      turn.status === "paused"
        ? "Turn paused — approval needed"
        : turn.status === "cancelled"
          ? "Cancelled — nothing was written"
          : turn.status === "done"
            ? "Agent finished"
            : turn.status === "error"
              ? "Agent stopped with an error"
              : "";
    if (text) setAnnouncement(text);
  }

  // Global shortcuts: Ctrl/Cmd+. stops; Ctrl/Cmd+Enter applies accepted hunks when Review is visible.
  const reviewVisible = (wide ? sideTab : tab) === "review";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === ".") {
        e.preventDefault();
        actions.cancelTurn();
      }
      if (mod && e.key === "Enter" && reviewVisible && stats.accepted > 0 && stats.pending === 0) {
        e.preventDefault();
        actions.reviewBulk("apply");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions, reviewVisible, stats.accepted, stats.pending]);

  const sideTabs = useMemo<TabItem<Exclude<TabId, "agent">>[]>(
    () => [
      { id: "context", label: "Context", icon: Layers, badge: state.context.items.length ? <Badge count={state.context.items.length} tone="neutral" label={`${state.context.items.length} context items`} /> : null },
      { id: "plan", label: "Plan", icon: ListChecks },
      { id: "review", label: "Review", icon: GitCompare, badge: <Badge count={reviewBadge} label={`${reviewBadge} hunks to review`} /> },
      { id: "timeline", label: "Timeline", icon: Activity },
    ],
    [reviewBadge, state.context.items.length],
  );
  const allTabs = useMemo<TabItem<TabId>[]>(() => [{ id: "agent", label: "Agent", icon: Bot }, ...sideTabs], [sideTabs]);

  const showWelcome = forceWelcome || (!state.ready ? false : app.connection.status !== "connected" || !app.model.primary) && state.conversation.length === 0;

  const onErrorAction = (intent: string, id: string) => {
    if (intent === "openModelConfig") setView("model");
    else if (intent === "startTrueForge") actions.startTrueForge();
    else if (intent === "retry") actions.checkConnection();
    actions.dismissError(id);
  };

  const banners = (
    <>
      {state.errors.map((e) => (
        <ErrorBanner key={e.id} error={e} onAction={(i) => onErrorAction(i, e.id)} onDismiss={() => actions.dismissError(e.id)} />
      ))}
      {state.retry ? <RetryBanner retry={state.retry} /> : null}
      <FallbackBanner model={app.model} />
    </>
  );

  const conversation = (
    <MessageList
      items={state.conversation}
      toolCalls={state.toolCalls}
      subagents={state.subagents}
      approvals={state.approvals}
      running={running}
      onDecide={actions.decideApproval}
      onOpenFile={actions.openFile}
      onOpenReview={() => (wide ? setSideTab("review") : setTab("review"))}
      emptyState={
        <EmptyState
          icon={Bot}
          title="What should FORGE build?"
          body={
            <>
              Describe the outcome — FORGE finds the files, plans, edits and verifies. Every change waits for your review. Inline edit: select code, <Kbd>Ctrl</Kbd>
              <Kbd>Alt</Kbd>
              <Kbd>K</Kbd>.
            </>
          }
        />
      }
    />
  );

  const composer = (
    <>
      <StatusStrip turn={turn} />
      <Composer
        running={running}
        cancelling={turn.status === "cancelling"}
        mentionSource={mentionSource}
        disabled={app.connection.status !== "connected"}
        disabledReason="Connect to TrueForge to start"
        onSubmit={(text, mentions) => {
          actions.submitTask(text, mentions);
          if (!wide) setTab("agent");
        }}
        onStop={actions.cancelTurn}
      />
    </>
  );

  const panel = (id: Exclude<TabId, "agent">) => {
    switch (id) {
      case "context":
        return <ContextInspector context={state.context} onOpen={actions.openFile} onIncludeAnyway={(p) => actions.openFile(p)} />;
      case "plan":
        return <PlanViewer steps={state.plan.steps} ignoredInvalid={state.plan.ignoredInvalid} onOpenFile={actions.openFile} />;
      case "review":
        return <DiffReview queue={review} onHunk={actions.reviewHunk} onFile={actions.reviewFile} onBulk={actions.reviewBulk} onOpenDiff={actions.openDiff} compact={narrow} />;
      case "timeline":
        return <ExecutionTimeline events={state.timeline} onOpenInTrueForge={actions.openInTrueForge} sessionId={app.activeSessionId} />;
    }
  };

  return (
    <div ref={rootRef} className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-bg text-fg">
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {view === "model" ? (
        <ModelConfigPanel model={app.model} onBack={() => setView("main")} onTest={actions.testModel} onFallbacksChange={actions.setFallbacks} />
      ) : view === "settings" ? (
        <SettingsPanel settings={app.settings} onBack={() => setView("main")} onChange={actions.updateSettings} />
      ) : (
        <>
          <Header
            sessions={app.sessions}
            activeSessionId={app.activeSessionId}
            model={app.model}
            running={running}
            onSelectSession={actions.selectSession}
            onNewSession={actions.newSession}
            onOpenModel={() => setView("model")}
            onOpenSettings={() => setView("settings")}
          />
          {showWelcome ? (
            <Welcome app={app} onStart={actions.startTrueForge} onCheck={actions.checkConnection} onNewSession={actions.newSession} onOpenModel={() => setView("model")} />
          ) : wide ? (
            <main className="flex min-h-0 flex-1">
              <section aria-label="Agent" className="flex min-h-0 min-w-0 flex-[1.1] flex-col border-r border-border">
                {banners}
                {conversation}
                {composer}
              </section>
              <section aria-label="Details" className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="border-b border-border">
                  <Tabs items={sideTabs} value={sideTab} onChange={setSideTab} label="FORGE details" idPrefix="forge-side" />
                </div>
                {sideTabs.map((t) => (
                  <TabPanel key={t.id} id={t.id} active={sideTab === t.id} idPrefix="forge-side" className="forge-scroll min-h-0 flex-1 overflow-y-auto">
                    {panel(t.id)}
                  </TabPanel>
                ))}
              </section>
            </main>
          ) : (
            <main className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-border">
                <Tabs items={allTabs} value={tab} onChange={setTab} label="FORGE sections" compact={narrow} />
              </div>
              {banners}
              <TabPanel id="agent" active={tab === "agent"} className="flex min-h-0 flex-1 flex-col">
                {conversation}
              </TabPanel>
              {sideTabs.map((t) => (
                <TabPanel key={t.id} id={t.id} active={tab === t.id} className={cn("forge-scroll min-h-0 flex-1 overflow-y-auto")}>
                  {panel(t.id)}
                </TabPanel>
              ))}
              {composer}
            </main>
          )}
        </>
      )}

      {state.toast ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-40 flex justify-center px-3">
          <Toast
            toast={state.toast}
            onDismiss={actions.dismissToast}
            onAction={() => {
              actions.reviewBulk("undo");
              actions.dismissToast();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
