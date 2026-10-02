/**
 * The route's stage while its conversation cannot show yet (a reload while the Mate is down): the
 * Mate's face asleep, its name and its link's one line (`MateLinkLine`), on one axis.
 */
import { MATE_VOICE_QUIET_MS } from "@t3tools/client-runtime/zerops/environments";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { environmentCatalog } from "~/connection/catalog";
import { useAtomCommand } from "~/state/use-atom-command";
import { rememberedMateIdentity } from "~/zerops/mateIdentityMemory";
import { mateOpeningStage } from "~/zerops/mateOpeningStage";
import { useMateVoice } from "~/zerops/mateVoiceContext";
import { useHeldPast } from "~/zerops/useHeldPast";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import { MateLinkLine, type Spoken } from "./MateLinkLine";
import { RouteStandIn } from "./RouteStandIn";
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
  composer = null,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly voice: Spoken;
  readonly projectId: string | null;
  /** The composer standing where its conversation's will (`ComposerStandIn`). */
  readonly composer?: ReactNode;
}) {
  return environmentId === null ? (
    <MateLinkWords voice={voice} />
  ) : (
    <MateLinkStageOf
      composer={composer}
      environmentId={environmentId}
      projectId={projectId}
      voice={voice}
    />
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
  composer,
}: {
  readonly environmentId: EnvironmentId;
  readonly voice: Spoken;
  readonly projectId: string | null;
  readonly composer: ReactNode;
}) {
  const at = useZeropsMate(environmentId);
  // Try now asks the link again, as the banner's does.
  const retry = useAtomCommand(environmentCatalog.retryNow);
  // Before the catalog names it, the Mate this browser last knew there: a reload draws its stage
  // from the first frame, and the listing's word replaces it once read.
  const known =
    at.kind === "mate"
      ? at.mate
      : at.kind === "unknown"
        ? rememberedMateIdentity(environmentId)
        : undefined;
  if (known === undefined) return <MateLinkWords voice={voice} />;
  const mate = { ...known, connected: false };
  return (
    <MateComingFrame composer={composer} header={<MateComingHeader mate={mate} />}>
      <MateEmptyStateView
        coming={{
          kind: "reaching",
          below: (
            <MateLinkLine
              mateServiceId={mate.serviceId}
              onTryNow={
                voice.actions.includes("try-now") ? () => void retry(environmentId) : undefined
              }
              projectId={projectId}
              projectUrl={mate.projectUrl}
              voice={voice}
            />
          ),
        }}
        mate={mate}
        phase={null}
        signIn={null}
        signInRequired={false}
        unknown={null}
      />
    </MateComingFrame>
  );
}

/**
 * A Mate's own view while its conversation is on its way (a reload, before the catalog names its
 * thread or before the chat layout can draw it): its header, its face and name at once, the
 * composer standing in — typed into, the conversation's own draft, which its composer reads as it
 * takes over — then "Opening Quinn…" past the quiet or the link's own words.
 */
export function MateOpeningView({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const environmentId = threadRef.environmentId;
  const voice = useMateVoice();
  const pastQuiet = useHeldPast(`opening:${environmentId}`, MATE_VOICE_QUIET_MS);
  const at = useZeropsMate(environmentId);
  const name =
    at.kind === "mate"
      ? at.mate.name
      : (rememberedMateIdentity(environmentId)?.name ?? "This Mate");
  return (
    <MateLinkStage
      composer={<RouteStandIn threadRef={threadRef} />}
      environmentId={environmentId}
      projectId={null}
      voice={mateOpeningStage({ voice, pastQuiet, mateName: name })}
    />
  );
}
