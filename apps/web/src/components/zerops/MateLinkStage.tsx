/**
 * The route's stage while its conversation cannot show yet (a reload while the Mate is down): the
 * Mate's face asleep, its name and its link's one line (`MateLinkLine`), on one axis.
 */
import type { EnvironmentId } from "@t3tools/contracts";

import { useZeropsMate } from "~/zerops/useZeropsMates";
import { MateLinkLine, type Spoken } from "./MateLinkLine";
import { MateComingFrame, MateComingHeader } from "./ZeropsMateComingPage";
import { MateEmptyStateView } from "./ZeropsMateEmptyState";

/**
 * The route's stage while its conversation cannot show: the Mate's face asleep, its name and its
 * line, on one axis. A route whose environment holds no Mate it knows says its line alone,
 * centred.
 */
export function MateLinkStage({
  environmentId,
  voice,
  projectId,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly voice: Spoken;
  readonly projectId: string | null;
}) {
  return environmentId === null ? (
    <MateLinkWords voice={voice} />
  ) : (
    <MateLinkStageOf environmentId={environmentId} projectId={projectId} voice={voice} />
  );
}

function MateLinkWords({ voice }: { readonly voice: Spoken }) {
  return (
    <div className="flex h-full flex-1 items-center justify-center p-8">
      <p className="text-center text-sm text-muted-foreground" role="status">
        {voice.text}
      </p>
    </div>
  );
}

function MateLinkStageOf({
  environmentId,
  voice,
  projectId,
}: {
  readonly environmentId: EnvironmentId;
  readonly voice: Spoken;
  readonly projectId: string | null;
}) {
  const at = useZeropsMate(environmentId);
  if (at.kind !== "mate") return <MateLinkWords voice={voice} />;
  const mate = { ...at.mate, connected: false };
  return (
    <MateComingFrame header={<MateComingHeader mate={mate} />}>
      <MateEmptyStateView
        coming={{
          kind: "reaching",
          below: (
            <MateLinkLine
              mateServiceId={mate.serviceId}
              onTryNow={undefined}
              projectId={projectId}
              projectUrl={mate.projectUrl}
              voice={voice}
            />
          ),
        }}
        mate={mate}
        onRetry={() => undefined}
        phase={null}
        signIn={null}
        signInRequired={false}
        unknown={null}
      />
    </MateComingFrame>
  );
}
