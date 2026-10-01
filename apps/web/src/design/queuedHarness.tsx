/**
 * A queued follow-up in every state its bubble reaches (`queuedBubbleState`): waiting for the
 * turn, held with the reason its send was refused, queued behind a held one, and the next while
 * a question waits on the person. Each state stands beside the waiting one at the same width, so
 * a change between them shows whether anything moves.
 *
 * Served by the dev server at `/design-queued.html` (`?theme=dark` for the dark theme).
 * Fixtures only: nothing here ships, and no route imports this module.
 */
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { EnvironmentId } from "@t3tools/contracts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { QueuedMessageTimelineRow } from "~/components/chat/MessagesTimeline";
import { TimelineRowCtx, type TimelineRowSharedState } from "~/components/chat/timelineContext";
import type { QueuedComposerMessage } from "~/queuedMessageStore";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const SHARED: TimelineRowSharedState = {
  timestampFormat: "24-hour",
  routeThreadKey: "harness",
  threadRef: null,
  markdownCwd: undefined,
  resolvedTheme: "light",
  workspaceRoot: undefined,
  skills: [],
  activeThreadEnvironmentId: EnvironmentId.make("environment-local"),
  onRevertToTurnCount: () => undefined,
  onRunShellCommand: undefined,
  onImageExpand: () => undefined,
  onOpenTurnDiff: () => undefined,
  speaker: { name: "Nova", tint: "sky" },
  standUpAsk: null,
  livePauseId: null,
  usagePause: null,
  onUsageAutoResumeChange: null,
  agentPanelModel: emptyAgentPanelModel(),
  onOpenAgents: () => undefined,
  onStopBackgroundWork: () => undefined,
  onSteerQueuedMessage: () => undefined,
  steerQueuedMessageShortcutLabel: "⌘↑",
  onRemoveQueuedMessage: () => undefined,
  arrivedAfter: null,
  syncing: false,
  onHoldReading: () => undefined,
};

const message = (
  id: string,
  prompt: string,
  held: Partial<QueuedComposerMessage> = {},
): QueuedComposerMessage => ({
  id,
  prompt,
  images: [],
  terminalContexts: [],
  reviewComments: [],
  submissionIntent: "foreground",
  queuedAfterToolActivityId: null,
  createdAt: "2026-10-01T09:00:00.000Z",
  ...held,
});

const FOLLOW_UP = "Once the checkout passes, deploy it to stage and send me the link.";

function Row({
  queued,
  isNext = true,
  heldAhead = false,
}: {
  readonly queued: QueuedComposerMessage;
  readonly isNext?: boolean;
  readonly heldAhead?: boolean;
}) {
  return (
    <QueuedMessageTimelineRow
      row={{
        kind: "queued-message",
        id: `queued-message:${queued.id}`,
        createdAt: queued.createdAt,
        queuedMessage: queued,
        isNext,
        heldAhead,
      }}
    />
  );
}

function State({
  label,
  blocked = false,
  children,
}: {
  readonly label: string;
  readonly blocked?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" data-harness-state={label}>
      <h2 className="text-muted-foreground text-xs">{label}</h2>
      <TimelineRowCtx value={{ ...SHARED, queueBlockedByAnswer: blocked }}>
        <div className="flex flex-col gap-3">{children}</div>
      </TimelineRowCtx>
    </section>
  );
}

function Harness() {
  return (
    <main className="mx-auto grid max-w-[1400px] grid-cols-2 gap-x-16 gap-y-10 p-10">
      <State label="Waiting for the turn">
        <Row queued={message("a", FOLLOW_UP)} />
        <Row isNext={false} queued={message("b", "Then write the release note.")} />
      </State>
      <State label="Held: its send was refused, the reason in the clock's place">
        <Row
          queued={message("a", FOLLOW_UP, {
            holdUntilUserAction: true,
            heldReason: "Your sign-in could not be recorded.",
          })}
        />
        <Row heldAhead isNext={false} queued={message("b", "Then write the release note.")} />
      </State>
      <State blocked label="Waiting on a question the person has to answer">
        <Row queued={message("a", FOLLOW_UP)} />
        <Row isNext={false} queued={message("b", "Then write the release note.")} />
      </State>
      <State label="Held by Stop: waits for Send now">
        <Row queued={message("a", FOLLOW_UP, { holdUntilUserAction: true })} />
      </State>
    </main>
  );
}

const appearance = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
