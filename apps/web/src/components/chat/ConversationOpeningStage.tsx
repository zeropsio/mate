import type { ZeropsMateIdentity } from "~/zerops/mateIdentities";
import { useState } from "react";
import { MateConnectionState } from "../zerops/ZeropsMateEmptyState";

/** One overlay survives the source read and row placement. Readiness changes both layers together. */
export function ConversationOpeningStage({
  ready,
  name,
  mate,
}: {
  readonly ready: boolean;
  readonly name: string | undefined;
  readonly mate: Pick<
    ZeropsMateIdentity,
    "name" | "tint" | "shape" | "connected" | "project"
  > | null;
}) {
  const [waited, setWaited] = useState(!ready);
  if (!ready && !waited) setWaited(true);
  if (!waited) return null;
  return (
    <div
      aria-hidden={ready ? true : undefined}
      className="pointer-events-none absolute inset-0 z-10"
      data-conversation-opening={ready ? "ready" : "waiting"}
    >
      <MateConnectionState
        mate={mate}
        face={ready ? "idle" : "sleep"}
        headline={`${name || "The Mate"} is opening the conversation.`}
        secondary="Picking up where you left off."
        actions={null}
      />
    </div>
  );
}
