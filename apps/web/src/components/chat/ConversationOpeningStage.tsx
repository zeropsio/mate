import type { ZeropsMateIdentity } from "~/zerops/mateIdentities";
import { useState, type ReactNode } from "react";
import { MateConnectionState } from "../zerops/ZeropsMateEmptyState";

/** One overlay survives the source read and row placement. Readiness changes both layers together. */
export function ConversationOpeningStage({
  ready,
  name,
  mate,
  notice,
}: {
  readonly notice?: ReactNode;
  readonly ready: boolean;
  readonly name: string | undefined;
  readonly mate: Pick<
    ZeropsMateIdentity,
    "name" | "tint" | "shape" | "connected" | "project"
  > | null;
}) {
  const [waited] = useState(!ready);
  const [arrived, setArrived] = useState(ready);
  if (ready && !arrived) setArrived(true);
  const handedOver = ready || arrived;
  if (!waited) return null;
  return (
    <div
      aria-hidden={handedOver ? true : undefined}
      className="pointer-events-none absolute inset-0 z-10"
      data-conversation-opening={handedOver ? "ready" : "waiting"}
    >
      <MateConnectionState
        notice={notice}
        mate={mate}
        face={handedOver ? "idle" : "sleep"}
        headline={`${name || "The Mate"} is opening the conversation.`}
        secondary="Picking up where you left off."
        actions={null}
      />
    </div>
  );
}
