/**
 * A Mate's peek in the app: the tree's row facts, and the thread's own plan
 * read while the peek is open.
 *
 * The shell paints the peek at once — what was asked, the last words, the
 * plan's count and the step it is on — and the thread's detail, subscribed
 * for as long as the peek stands, fills in every step's words. The plan's
 * list keeps its height while that happens (`matePeekSteps`).
 */
import * as Option from "effect/Option";
import { useEffect, useMemo } from "react";

import { deriveActivePlanState } from "~/session-logic";
import { useEnvironmentThread } from "~/state/threads";
import type { ZeropsCandidatePresentation } from "~/zerops/useZeropsCandidates";

import { MatePeekCard } from "./SidebarMatePeek";
import { askedLabelFor, matePeekSteps } from "./SidebarMatePeek.logic";
import type { SidebarPeekRender } from "./SidebarZeropsTree";

export function SidebarMatePeekLive({
  peek,
}: {
  readonly peek: SidebarPeekRender<ZeropsCandidatePresentation>;
}) {
  const { activity } = peek;
  const environmentId = peek.candidate.environmentId ?? null;
  const thread = useEnvironmentThread(environmentId, activity?.threadId ?? null);
  const detail = Option.getOrUndefined(thread.data);
  const plan = useMemo(
    () =>
      detail === undefined
        ? null
        : deriveActivePlanState(detail.activities, detail.latestTurn?.turnId ?? undefined),
    [detail],
  );
  const working = activity?.kind === "working" || activity?.kind === "connecting";
  const paused = activity?.pausedUntil !== undefined;
  const steps =
    working || paused
      ? matePeekSteps({
          plan,
          progress:
            activity?.progress === undefined || activity.subject === undefined
              ? undefined
              : {
                  step: activity.subject,
                  completedSteps: activity.progress.completed,
                  totalSteps: activity.progress.total,
                },
        })
      : undefined;

  // Escape closes a peek wherever the focus is — the row, the peek, the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) peek.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [peek]);

  return (
    <MatePeekCard
      appUrl={peek.appUrl}
      askedLabel={askedLabelFor(peek.owner)}
      change={peek.change}
      decision={undefined}
      face={peek.face}
      lastWords={activity?.snippet}
      name={peek.name}
      onChoose={() => {}}
      onMore={peek.onMore}
      onOpen={peek.onOpen}
      onStop={undefined}
      onText={() => {}}
      projectName={peek.projectName}
      responding={false}
      steps={steps}
      stepsLabel={paused ? "Plan, paused at a usage limit" : "Plan"}
      task={activity?.task}
      time={peek.time}
      tint={peek.tint}
      waitingOn={undefined}
    />
  );
}
