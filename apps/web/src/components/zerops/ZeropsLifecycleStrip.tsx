/**
 * The lifecycle strip: one band below the thread header saying where the agent
 * is in the Zerops workflow.
 *
 * Absent until the thread's agent has run a workflow-aware Zerops tool, except
 * when the closed service map needs an in-flow authorization entry. Lifecycle
 * wording is decided in `@t3tools/client-runtime/zerops/strip` and tested
 * there; the line below is split out from the feed-reading container so its
 * markup can be tested without a live atom registry.
 *
 * Clicking it opens the service map, which is the question the strip provokes.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { StatusDot } from "./primitives";
import type { ZeropsOperation, ZeropsSessionView } from "@t3tools/client-runtime/zerops/model";
import {
  type ZeropsStripState,
  type ZeropsStripTone,
  zeropsStripState,
} from "@t3tools/client-runtime/zerops/strip";

const TONE_CLASS: Record<ZeropsStripTone, string> = {
  active: "bg-[var(--zerops-status-busy-surface)] text-foreground",
  done: "bg-[var(--zerops-status-ok-surface)] text-success-foreground",
  idle: "bg-[var(--zerops-status-off-surface)] text-muted-foreground",
  waiting: "bg-[var(--zerops-status-attention-surface)] text-warning-foreground",
};

const STATUS_TONE: Record<ZeropsStripTone, "attention" | "busy" | "off" | "ok"> = {
  active: "busy",
  done: "ok",
  idle: "off",
  waiting: "attention",
};
const AGENT_AUTH_ATTENTION_LABEL = "Coding agent sign-in required";

export function ZeropsStripLine({
  state,
  onOpen,
  agentAuthNeedsAttention = false,
}: {
  readonly state: ZeropsStripState | undefined;
  readonly onOpen: () => void;
  readonly agentAuthNeedsAttention?: boolean;
}) {
  if (state === undefined && !agentAuthNeedsAttention) {
    return null;
  }
  const visibleState =
    state ??
    ({
      tone: "waiting",
      label: AGENT_AUTH_ATTENTION_LABEL,
    } satisfies ZeropsStripState);
  const ariaLabel = `Zerops: ${visibleState.label}${
    state !== undefined && agentAuthNeedsAttention ? ` · ${AGENT_AUTH_ATTENTION_LABEL}` : ""
  }`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={ariaLabel}
            className={cn(
              "flex h-7 w-full min-w-0 cursor-pointer items-center overflow-hidden px-3 text-xs font-medium transition-colors hover:brightness-95",
              TONE_CLASS[visibleState.tone],
            )}
            data-zerops-lifecycle-band="true"
            data-zerops-strip-tone={visibleState.tone}
            onClick={onOpen}
            type="button"
          />
        }
      >
        <StatusDot
          className="overflow-hidden"
          data-zerops-agent-auth-attention={state === undefined ? "true" : undefined}
          label={visibleState.label}
          pulse={visibleState.tone === "active"}
          tone={STATUS_TONE[visibleState.tone]}
        />
        {state !== undefined && agentAuthNeedsAttention ? (
          <StatusDot
            className="ml-auto shrink-0 pl-3"
            data-zerops-agent-auth-attention="true"
            label={AGENT_AUTH_ATTENTION_LABEL}
            pulse={false}
            tone="attention"
          />
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="bottom">Open the Zerops service map</TooltipPopup>
    </Tooltip>
  );
}

export function ZeropsLifecycleStrip({
  threadRef,
  pendingUserInput,
  session,
  running,
  agentAuthNeedsAttention = false,
  zeropsPanelOpen = false,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly pendingUserInput: boolean;
  /** The thread's own model state — the caller (`ChatView`) derives this once for every Zerops surface. */
  readonly session: ZeropsSessionView | undefined;
  readonly running: ZeropsOperation | undefined;
  readonly agentAuthNeedsAttention?: boolean;
  readonly zeropsPanelOpen?: boolean;
}) {
  const state = zeropsStripState(session, running, pendingUserInput);

  if (threadRef === null) {
    return null;
  }

  return (
    <ZeropsStripLine
      agentAuthNeedsAttention={agentAuthNeedsAttention && !zeropsPanelOpen}
      onOpen={() => {
        useRightPanelStore.getState().open(threadRef, "zerops");
      }}
      state={state}
    />
  );
}
