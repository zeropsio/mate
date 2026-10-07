import type { ZeropsMateIdentity } from "../../zerops/mateIdentities";
import { Button } from "../ui/button";
import { MateEmptyStateView } from "./ZeropsMateEmptyState";

/** An inventory attempt ended; its receipt supplies the reason and the recovery action. */
export function MateDetailFailure({
  message,
  again,
  mate = null,
}: {
  readonly message: string;
  readonly again: () => void;
  readonly mate?: ZeropsMateIdentity | null | undefined;
}) {
  return (
    <MateEmptyStateView
      mate={mate?.name ? mate : null}
      phase={null}
      signIn={null}
      signInRequired={false}
      unknown={null}
      coming={{
        kind: "unreachable",
        face: "sleep",
        severity: "danger",
        headline: `${mate?.name || "The Mate"}'s project could not be read.`,
        sentence: message,
        below: (
          <Button onClick={again} size="compact" variant="pill">
            Again
          </Button>
        ),
      }}
    />
  );
}
