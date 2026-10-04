/**
 * One helper's own work, opened from its row: the task it was given, its run
 * as the Mate's run card draws one — each call a step, the one in flight on
 * its now line beside its clock — and, once it ended, its report whole.
 *
 * A driver that forwards no helper's calls leaves it no steps: its card is
 * its task, what it does now as its driver says it, and its report.
 */
import type { OrchestrationThreadActivity, ScopedThreadRef } from "@t3tools/contracts";
import {
  emptyAgentPanelModel,
  formatSubagentModelLabel,
  formatSubagentTokenCount,
  isActiveSubagentStatus,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useCallback, useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import { useKnownMate } from "~/zerops/useZeropsMates";
import ChatMarkdown from "../ChatMarkdown";
import { helperCallsLeftOut, helperNowWords, helperRecord } from "./helpers.logic";
import { RunChat } from "./RunChat";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
} from "./timelineContext";

const NOOP = () => undefined;

function HelperTask({ prompt }: { readonly prompt: string }) {
  const [open, setOpen] = useState(false);
  // Cut short at four lines, as measured: only then does it open onto the rest.
  const [cut, setCut] = useState(false);
  const watch = useCallback((element: HTMLParagraphElement | null) => {
    if (element === null) return;
    const measure = () => setCut(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <section className="grid gap-1">
      <h4 className="helper-card-heading">Its task</h4>
      <p
        ref={open ? undefined : watch}
        className={cn(
          "whitespace-pre-wrap break-words text-foreground/85 text-line",
          !open && "line-clamp-4",
        )}
      >
        {prompt}
      </p>
      {open || cut ? (
        <button
          className="justify-self-start cursor-pointer rounded text-info-foreground text-line hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {open ? "Less" : "All of it"}
        </button>
      ) : null}
    </section>
  );
}

/** What it ran on and what it cost: kept, but quiet. */
export function helperCostWords(helper: RuntimeSubagent): string | null {
  const parts = [
    formatSubagentModelLabel(helper.model, helper.effort),
    helper.usage ? `${formatSubagentTokenCount(helper.usage.totalTokens)} tokens` : null,
    helper.usage?.toolUses !== undefined
      ? `${helper.usage.toolUses} ${helper.usage.toolUses === 1 ? "call" : "calls"}`
      : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

export function HelperCard({
  helper,
  activities,
  threadRef,
}: {
  readonly helper: RuntimeSubagent;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly threadRef: ScopedThreadRef;
}) {
  const mate = useKnownMate(threadRef.environmentId);
  const live = isActiveSubagentStatus(helper.status);
  const record = useMemo(() => helperRecord({ helper, activities }), [helper, activities]);
  const threadKey = scopedThreadKey(threadRef);
  const shared = useMemo<TimelineRowSharedState>(
    () => ({
      timestampFormat: "24-hour",
      // Its own run's fold, apart from the Mate's runs.
      routeThreadKey: `${threadKey}#helper:${helper.id}`,
      threadRef,
      markdownCwd: undefined,
      resolvedTheme: "light",
      workspaceRoot: undefined,
      skills: [],
      activeThreadEnvironmentId: threadRef.environmentId,
      onRevertToTurnCount: NOOP,
      onRunShellCommand: undefined,
      onImageExpand: NOOP,
      onOpenTurnDiff: NOOP,
      // It works for the Mate, in the Mate's colour; its row above names it.
      speaker: { name: "Helper", tint: mate?.tint ?? "slate", shape: mate?.shape },
      standUpAsk: null,
      livePauseId: null,
      usagePause: null,
      onUsageAutoResumeChange: null,
      agentPanelModel: emptyAgentPanelModel(),
      onOpenAgents: NOOP,
      onStopBackgroundWork: NOOP,
      onSteerQueuedMessage: NOOP,
      steerQueuedMessageShortcutLabel: null,
      onRemoveQueuedMessage: NOOP,
      arrivedAfter: null,
      syncing: false,
      onHoldReading: NOOP,
    }),
    [threadKey, threadRef, helper.id, mate?.tint, mate?.shape],
  );
  const activity = useMemo<TimelineRowActivityState>(
    () => ({
      isWorking: live,
      isCompacting: false,
      isRevertingCheckpoint: false,
      latestTurnId: null,
      workingStepLabel: null,
      stoppingBackgroundWork: false,
    }),
    [live],
  );
  const now = helperNowWords(helper);
  const leftOut = useMemo(() => helperCallsLeftOut(helper, activities), [helper, activities]);
  const report = helper.status === "failed" ? (helper.error ?? helper.result) : helper.result;
  return (
    <div className="helper-card grid gap-4" data-helper-card={helper.id}>
      {helper.prompt ? <HelperTask prompt={helper.prompt} /> : null}
      {record !== null && leftOut > 0 ? (
        <p className="helper-card-heading">
          {`Its first ${leftOut} ${leftOut === 1 ? "call is" : "calls are"} not loaded here`}
        </p>
      ) : null}
      {record !== null ? (
        <TimelineRowCtx value={shared}>
          <TimelineRowActivityCtx value={activity}>
            <div className="run-tray run-tray-whole helper-card-run">
              <RunChat row={record} />
            </div>
          </TimelineRowActivityCtx>
        </TimelineRowCtx>
      ) : live && now !== null ? (
        // No steps to draw: what it does now, as its driver says it.
        <p className="text-foreground/80 text-line">{now}</p>
      ) : null}
      {!live && report ? (
        <section className="grid gap-1">
          <h4 className="helper-card-heading">
            {helper.status === "failed" ? "Why it failed" : "Its report"}
          </h4>
          <ChatMarkdown
            className={helper.status === "failed" ? "text-status-failed-text" : "text-foreground"}
            cwd={undefined}
            text={report}
            threadRef={threadRef}
          />
        </section>
      ) : null}
    </div>
  );
}
