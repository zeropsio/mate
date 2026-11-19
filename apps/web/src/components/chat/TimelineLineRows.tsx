import { type MateTaskSource } from "@t3tools/contracts";
import { use } from "react";
import { PublishedPage } from "./PublishedPage";
import { ConversationAfterWork } from "./ConversationWorking";
import { BackgroundLine, RunChat, RunLine } from "./RunChat";
import { backgroundLineOf, backgroundRowItems } from "./backgroundLine.logic";
import {
  TimelineNoticesCtx,
  TimelineRowActivityCtx,
  TimelineRowCtx,
  TimelineWorkingCtx,
} from "./timelineContext";
import { ErrorLine, EventLine, NoticeLine, Seam } from "./ConversationRows";
import { CrewTaskCard } from "../zerops/crew/CrewTaskCard";
import { MateTaskCard } from "../zerops/MateTaskCard";
import { useRightPanelStore } from "~/rightPanelStore";
import type { MessagesTimelineRow as TimelineRow } from "./MessagesTimeline.logic";

/** A task at its turn's start, read by its own id for the Mate living in its environment. */
export function TaskCardTimelineRow({
  source,
  text,
  taskId,
}: {
  source: MateTaskSource;
  text: string;
  taskId: string | null;
}) {
  const { threadRef } = use(TimelineRowCtx);
  if (threadRef === null) return null;
  return (
    <MateTaskCard
      conversationId={threadRef.threadId}
      environmentId={threadRef.environmentId}
      onOpenChange={(change) =>
        useRightPanelStore.getState().openChange(threadRef, {
          groupId: change.appId,
          repository: change.repo,
          number: change.number,
        })
      }
      task={source}
      taskId={taskId}
      text={text}
    />
  );
}

export function ErrorTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "error" }> }) {
  const { onDismissEndNotice } = use(TimelineRowCtx);
  return (
    <ErrorLine
      label={row.entry.label}
      detail={row.entry.detail}
      calm={row.calm}
      onDismiss={row.dismissible ? onDismissEndNotice : undefined}
    />
  );
}

export function WorkLineTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "work-line" }> }) {
  return <RunLine status={row} />;
}

/** Work that outlived the turn: the Mate at work, smaller, until it ends. */
export function AfterWorkTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "after-work" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const dock = use(TimelineWorkingCtx);
  const { isStopping } = use(TimelineRowActivityCtx);
  return (
    <ConversationAfterWork
      dock={dock}
      environmentId={ctx.activeThreadEnvironmentId}
      onOpenAgents={ctx.onOpenAgents}
      speaker={ctx.speaker}
      state={row.state}
      stopping={isStopping === true}
      threadRef={ctx.threadRef}
    />
  );
}

/**
 * A run's chat in its card: every bubble in one scroll, and, while the Mate
 * works, its face beside what it is on at the end — the one place the present
 * is shown, so nothing is ever drawn twice (the owner, 2026-09-27: "it
 * literally duplicates what's the mate bubbles").
 */
export function RecordTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "record" }> }) {
  return <RunChat row={row} />;
}

/**
 * Background work as one quiet line (`backgroundLine.logic`): what a settled
 * turn sent to the background, on its own card (`jobs:`), work that finished
 * outside any turn, or what woke the run under it.
 */
export function BackgroundTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "background" }>;
}) {
  return (
    <BackgroundLine
      line={backgroundLineOf(
        backgroundRowItems({ ...row, key: row.id }),
        row.helpers,
        row.quiet === true,
      )}
    />
  );
}

export function EventTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "event" }> }) {
  const ctx = use(TimelineRowCtx);
  return (
    <EventLine
      at={row.createdAt}
      event={row.event}
      speaker={ctx.speaker}
      timestampFormat={ctx.timestampFormat}
    />
  );
}

export function NoticeTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "notice" }> }) {
  const notice = use(TimelineNoticesCtx).get(row.noticeId);
  return notice === undefined ? null : <NoticeLine notice={notice} />;
}

/** The task the server handed a crewmate, drawn as a task (`CrewTaskCard.tsx`). */
export function CrewCardTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "crew-card" }> }) {
  return <CrewTaskCard card={row.task} id={row.id} />;
}

/** A page the Mate published, right above its answer. */
export function PageTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "page" }> }) {
  const ctx = use(TimelineRowCtx);
  if (ctx.threadRef === null) return null;
  return (
    <PublishedPage
      page={row.page}
      itemId={row.itemId}
      environmentId={ctx.threadRef.environmentId}
      threadId={ctx.threadRef.threadId}
    />
  );
}

export function SeamTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "seam" }> }) {
  const ctx = use(TimelineRowCtx);
  return <Seam row={row} timestampFormat={ctx.timestampFormat} />;
}
