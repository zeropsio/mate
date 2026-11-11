/**
 * Who waits on the person at the composer's top: the asking Mate's face in its needs pose, or a
 * plain agent's mark, and its name. The ask itself is the kit's compact density (`AskDock`).
 */
import type { EnvironmentId } from "@t3tools/contracts";

import { useKnownMate } from "~/zerops/useZeropsMates";

import { MateFace } from "../zerops/primitives";

/** A plain agent's mark where no Mate lives: the amber of who is next. */
export function ComposerAskMark() {
  return (
    <span
      aria-hidden="true"
      className="size-2.5 justify-self-center rounded-full bg-status-attention"
    />
  );
}

/** The asking Mate's face, waiting on the person; a plain agent's mark where no Mate lives here. */
export function ComposerAskFace({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const mate = useKnownMate(environmentId);
  return mate === undefined ? (
    <ComposerAskMark />
  ) : (
    <MateFace shape={mate.shape} size={24} state="needs" tint={mate.tint} />
  );
}

/** Who asks, by name: the Mate living here, else the agent. */
export function useComposerAskName(environmentId: EnvironmentId): string {
  return useKnownMate(environmentId)?.name ?? "The agent";
}
