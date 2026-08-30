/**
 * The lifecycle strip: one line in the thread header saying where the agent is
 * in the Zerops workflow.
 *
 * Absent entirely until the thread's agent has run a workflow-aware Zerops
 * tool, so a thread that never touches Zerops never grows a strip. The wording
 * is decided in `@t3tools/client-runtime/zerops/strip` and tested there; the line below is
 * split out from the feed-reading container so its markup can be tested
 * without a live atom registry.
 *
 * Clicking it opens the service map, which is the question the strip provokes.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import {
  type ZeropsStripState,
  type ZeropsStripTone,
  zeropsStripState,
} from "@t3tools/client-runtime/zerops/strip";
import { useZeropsLifecycle } from "../../zerops/useZeropsFeeds";

const TONE_CLASS: Record<ZeropsStripTone, string> = {
  active: "text-foreground",
  done: "text-success-foreground",
  idle: "text-muted-foreground",
  waiting: "text-warning-foreground",
};

export function ZeropsStripLine({
  state,
  onOpen,
}: {
  readonly state: ZeropsStripState | undefined;
  readonly onOpen: () => void;
}) {
  if (state === undefined) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={`Zerops: ${state.label}`}
            className={cn(
              "flex min-w-0 shrink cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent/50",
              TONE_CLASS[state.tone],
            )}
            data-zerops-lifecycle-strip
            data-zerops-strip-tone={state.tone}
            onClick={onOpen}
            type="button"
          />
        }
      >
        {state.tone === "active" ? <Spinner className="size-3 shrink-0" /> : null}
        <span className="truncate">{state.label}</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">Open the Zerops service map</TooltipPopup>
    </Tooltip>
  );
}

export function ZeropsLifecycleStrip({
  environmentId,
  threadId,
  pendingUserInput,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly pendingUserInput: boolean;
}) {
  const lifecycle = useZeropsLifecycle(environmentId, threadId);
  const state = zeropsStripState(lifecycle, { pendingUserInput });

  if (environmentId === null || threadId === null) {
    return null;
  }

  return (
    <ZeropsStripLine
      onOpen={() => {
        useRightPanelStore.getState().open(scopeThreadRef(environmentId, threadId), "zerops");
      }}
      state={state}
    />
  );
}
