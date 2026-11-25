import { AsteriskIcon, OctagonAlertIcon, TriangleAlertIcon } from "lucide-react";
import { use, type ReactNode } from "react";
import { cn } from "~/lib/utils";
import { MARK_COLUMN, MARK_GAP, type MarkLine, Mark, HelperFace } from "./RunMarks";
import { AnswerFiles, PersonMark } from "./RunPersonMark";
import { NoteBubble, QuestionBubble, ThoughtBubble } from "./RunWordsBubbles";
import { StepBubble } from "./RunCallBubbles";
import {
  StandupBubble,
  OperationBubble,
  ChecksBubble,
  IncidentMark,
  IncidentBubble,
} from "./RunOperationBubbles";
import { HelpersBubble, TaskBubble, PlanBubble } from "./RunHelperBubbles";
import { NoticeBubble, EventCaption } from "./RunNoticeBubbles";
import { CrewSeamActivity } from "../zerops/crew/CrewTaskCard";
import { MateFace } from "../zerops/primitives";
import { type RecordItem } from "./MessagesTimeline.logic";
import { TimelineRowCtx } from "./timelineContext";
import { stepOf } from "~/zerops/runSteps/steps";
import { ChatLineContext, InSlotContext, useRisesIn } from "./runCardContext";
import { type ChatLine } from "./runChatLine";

/** A thought's mark: a small asterisk, fainter than a call's. */
export const THOUGHT_MARK = (
  <AsteriskIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/70" />
);

/**
 * A thought's mark where it stands: its asterisk in the log; in the working
 * row the Mate's own face at work, as every item there wears while it is
 * what the Mate does now (the board, 2026-11-10).
 */
function ThoughtMark() {
  const ctx = use(TimelineRowCtx);
  if (!use(InSlotContext)) return THOUGHT_MARK;
  if (ctx.speaker.helper) return <HelperFace />;
  return <MateFace shape={ctx.speaker.shape} size={20} state="working" tint={ctx.speaker.tint} />;
}

/** Its words' mark: its own face, at rest — who is speaking, beside what it said. */
function SpeakerMark() {
  const ctx = use(TimelineRowCtx);
  if (ctx.speaker.helper) return <HelperFace />;
  return <MateFace shape={ctx.speaker.shape} size={20} state="idle" tint={ctx.speaker.tint} />;
}

/**
 * A record's item as its line of the chat; `undone` the failures that stand
 * quiet (`recoveredFailures`): a later step undid them, or their run ended well.
 */
export function itemLine(item: RecordItem, undone: ReadonlySet<string>): ChatLine {
  switch (item.kind) {
    case "step":
      return {
        key: item.key,
        bubble: <StepBubble step={item.step} undone={undone.has(item.key)} />,
        call: true,
      };
    case "call":
      if (item.entry.questionAnswer !== undefined) {
        const attachments = Object.values(item.entry.questionAnswer.attachmentsByQuestionId).flat();
        return { key: item.key, bubble: <AnswerFiles attachments={attachments} />, theirs: true };
      }
      return {
        key: item.key,
        bubble: <StepBubble step={stepOf(item.entry, undefined, false)} />,
        call: true,
      };
    case "thought":
      return {
        key: item.key,
        bubble: <ThoughtBubble messages={item.messages} />,
        mark: <ThoughtMark />,
        markLine: "thought",
      };
    case "note":
      return {
        key: item.key,
        bubble: <NoteBubble message={item.message} />,
        mark: <SpeakerMark />,
        said: true,
      };
    case "question":
      return {
        key: item.key,
        bubble: <QuestionBubble questions={item.questions} />,
        mark: <SpeakerMark />,
        asks: true,
        said: true,
      };
    case "person":
      return { key: item.key, bubble: <PersonMark item={item} />, theirs: true };
    case "operation":
      return {
        key: item.key,
        bubble:
          item.operation.kind === "standup" && item.noResult === undefined ? (
            <StandupBubble operation={item.operation} undone={undone.has(item.key)} />
          ) : (
            <OperationBubble
              noResult={item.noResult}
              operation={item.operation}
              undone={undone.has(item.key)}
            />
          ),
        call: true,
      };
    case "helpers":
      return { key: item.key, bubble: <HelpersBubble entry={item.entry} />, call: true };
    case "task":
      return {
        key: item.key,
        bubble: <TaskBubble entry={item.entry} undone={undone.has(item.key)} />,
        call: true,
      };
    case "plan":
      return { key: item.key, bubble: <PlanBubble plan={item.plan} />, call: true };
    case "strip":
      return { key: item.key, bubble: <ChecksBubble strip={item.strip} />, call: true };
    case "incident":
      return {
        key: item.key,
        bubble: <IncidentBubble incident={item.incident} />,
        mark: <IncidentMark incident={item.incident} />,
        markLine: "call",
      };
    case "event":
      return { key: item.key, bubble: <EventCaption event={item.event} />, across: true };
    case "crew-seam":
      return {
        key: item.key,
        bubble: <CrewSeamActivity seam={item.seam} words={item.words} />,
        across: true,
      };
    case "error":
    case "warning":
      return {
        key: item.key,
        bubble: <NoticeBubble entry={item.entry} kind={item.kind} />,
        markLine: "call",
        mark:
          item.kind === "warning" ? (
            <TriangleAlertIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-warning-foreground"
            />
          ) : (
            <OctagonAlertIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-status-failed-text"
            />
          ),
      };
  }
}

/**
 * A line of the chat: the Mate's column — each bubble's mark beside its first
 * line, its face at the column's foot, on the status line — then the bubble;
 * the person's words on their own side; or a caption across both.
 */
export function ChatRow({
  lineKey,
  across,
  theirs,
  pairs = false,
  said = false,
  mark,
  markLine,
  children,
}: {
  /** The line it draws: what its plop finds it by. */
  readonly lineKey: string;
  readonly across: boolean;
  readonly theirs: boolean;
  /** It answers the question right above it: 6 px under it, not 16. */
  readonly pairs?: boolean;
  /** The Mate's words: 22 px over and under them, where rows stand 16 px apart. */
  readonly said?: boolean;
  readonly mark?: ReactNode;
  readonly markLine?: MarkLine | undefined;
  readonly children: ReactNode;
}) {
  const rises = useRisesIn();
  // In the working row an item stands alone: the panel's own padding is its room.
  const roomy = said && !use(InSlotContext);
  // What it opens is kept by its key, across its slot row and its history row.
  children = <ChatLineContext value={lineKey}>{children}</ChatLineContext>;
  if (across) {
    return (
      <li className="min-w-0" data-chat-row data-run-key={lineKey}>
        {children}
      </li>
    );
  }
  return (
    <li
      className={cn("flex min-w-0 items-start", MARK_GAP, pairs ? "-mt-4" : roomy && "my-1.5")}
      data-chat-row
      data-run-key={lineKey}
    >
      {/* The Mate's column, on a phone's card too: it holds the marks that
          tell the bubbles apart, so every bubble keeps one edge. */}
      {mark === undefined ? (
        <span aria-hidden="true" className={MARK_COLUMN} />
      ) : (
        <Mark line={markLine}>{mark}</Mark>
      )}
      {/* Only what arrives while the person watches rises in. */}
      <div
        className={cn(
          "flex min-w-0 flex-1",
          theirs && "justify-end",
          rises && "animate-run-rise motion-reduce:animate-none",
        )}
        data-run-rises={rises ? "" : undefined}
      >
        {children}
      </div>
    </li>
  );
}
