/**
 * The one line below the thread header that asks for something: a coding
 * agent to sign in, when none is authorized and the conversation already has
 * messages. An empty conversation asks in its own empty state
 * (`ZeropsMateEmptyState`), and where the agent is in the Zerops workflow is
 * the timeline's and the service map's to say — the band that used to repeat
 * it here told nobody anything they could not see below it.
 *
 * The line sits in the timeline's column, at the timeline's width, and paints
 * nothing across the page: a dot, the request as a sentence, a chevron.
 * Clicking it starts the sign-in when the caller can, else opens the service
 * map, where the agents are.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useRightPanelStore } from "../../rightPanelStore";
import { StatusDot } from "./primitives";
import type { ZeropsOperation, ZeropsSessionView } from "@t3tools/client-runtime/zerops/model";

const AGENT_AUTH_ATTENTION_LABEL = "Coding agent sign-in required";

export function ZeropsStripLine({
  onOpen,
  onOpenAgentAuth,
}: {
  /** Opens the service map — the fallback door to the agents. */
  readonly onOpen: () => void;
  /** Starts the sign-in the line is asking for; a click should do what it says. */
  readonly onOpenAgentAuth?: (() => void) | undefined;
}) {
  return (
    <div
      className="flex w-full shrink-0 justify-center px-5 sm:px-6"
      data-zerops-lifecycle-band="true"
      data-zerops-strip-tone="waiting"
    >
      <div className="flex h-8 w-full max-w-3xl items-center">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                aria-label={`Zerops: ${AGENT_AUTH_ATTENTION_LABEL}`}
                className="-ms-2 inline-flex h-7 max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-warning-foreground transition-colors hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                onClick={onOpenAgentAuth ?? onOpen}
                type="button"
              />
            }
          >
            <StatusDot
              className="min-w-0"
              data-zerops-agent-auth-attention="true"
              label={AGENT_AUTH_ATTENTION_LABEL}
              pulse={false}
              sentence
              tone="attention"
            />
            <ChevronRightIcon
              aria-hidden="true"
              className="size-3 shrink-0 text-muted-foreground"
            />
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            {onOpenAgentAuth === undefined
              ? "Open the Zerops service map"
              : "Sign in the coding agent"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
}

export function ZeropsLifecycleStrip({
  threadRef,
  agentAuthNeedsAttention = false,
  zeropsPanelOpen = false,
  onOpenAgentAuth,
  session,
  running,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly agentAuthNeedsAttention?: boolean;
  readonly zeropsPanelOpen?: boolean;
  readonly onOpenAgentAuth?: (() => void) | undefined;
  /**
   * The thread's Zerops lifecycle, as the caller (`ChatView`) derives it once
   * for every Zerops surface. Read only for whether there is one: a
   * conversation the agent has worked in asks for the sign-in here; an empty
   * one asks in its own empty state. What the lifecycle says is not this
   * line's to repeat.
   */
  readonly session?: ZeropsSessionView | undefined;
  readonly running?: ZeropsOperation | undefined;
  /** Handed over by the caller; a waiting question is the timeline's to show, not a band's. */
  readonly pendingUserInput?: boolean;
}) {
  const underway = session?.phase !== undefined || running !== undefined;

  if (threadRef === null || !agentAuthNeedsAttention || zeropsPanelOpen || !underway) {
    return null;
  }

  return (
    <ZeropsStripLine
      onOpen={() => {
        useRightPanelStore.getState().open(threadRef, "zerops");
      }}
      onOpenAgentAuth={onOpenAgentAuth}
    />
  );
}
