import { type EnvironmentId } from "@t3tools/contracts";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import { type MateStandUpStopped } from "~/zerops/mateStandUp";
import { ZeropsMateEmptyState } from "../zerops/ZeropsMateEmptyState";

/**
 * Nothing said yet. In a Mate's conversation that is the Mate's own opening —
 * its mark, its question, and the sign-in when no agent could act, or its
 * setup that never started (`ZeropsMateEmptyState`); elsewhere upstream's one line.
 */
export function TimelineEmptyState({
  environmentId,
  threadKey,
  bottomInset,
  standUpStopped,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadKey: string;
  readonly bottomInset: number;
  readonly standUpStopped: MateStandUpStopped | null;
}) {
  const whoLivesHere = useZeropsMate(environmentId);
  // Neither opening while that is not known: the region stays, empty.
  if (whoLivesHere.kind === "unknown") return <div className="h-full" />;
  if (whoLivesHere.kind === "nobody") {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-placeholder text-sm">Send a message to start the conversation.</p>
      </div>
    );
  }
  return (
    <ZeropsMateEmptyState
      bottomInset={bottomInset}
      environmentId={environmentId}
      mate={whoLivesHere.mate}
      standUpStopped={standUpStopped}
      threadRef={parseScopedThreadKey(threadKey)}
    />
  );
}
