/**
 * A Mate's page while its conversation cannot show yet (a reload before the catalog names its
 * thread, the route's link being made, the Mate down): its header — the face and the name — from
 * the first frame, as its conversation will draw it, awake where its container runs. Opening, the
 * page under it is quiet, with one line where the messages will land past its beat; where the link
 * has words of its own (a restart, a reconnect, a container that is not running) the Mate's face
 * stands asleep over its name with them, on one axis (`stageSpeaks`).
 */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { useMateDetailRead } from "~/zerops/accountEnvironments";
import { MateDetailFailure } from "./MateDetailFailure";

import { environmentCatalog } from "~/connection/catalog";
import { useAtomCommand } from "~/state/use-atom-command";
import { rememberedMateIdentity } from "~/zerops/mateIdentityMemory";
import { mateOpeningAwake, type ZeropsMateIdentity } from "~/zerops/mateIdentities";
import { stageSpeaks } from "~/zerops/mateOpeningStage";
import { useMateVoice } from "~/zerops/mateVoiceContext";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import { OPENING_WAIT_LINE_MS, openingConversationLine } from "~/zerops/waitLine.logic";
import { Button } from "../ui/button";
import { MateLinkLine, MateLinkProcesses, type Spoken } from "./MateLinkLine";
import { RouteStandIn } from "./RouteStandIn";
import { PageWaitLine } from "./WaitLine";
import { MateComingFrame, MateComingHeader } from "./ZeropsMateComingPage";
import { MateEmptyStateView } from "./ZeropsMateEmptyState";

const SILENT_STAGE: Spoken = { surface: "stage", text: null, actions: [], processes: false };

/**
 * The route's page while its conversation cannot show. A route whose environment holds no Mate it
 * knows waits quietly with its line alone.
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
  const { failure, again } = useMateDetailRead(projectId, environmentId);
  if (failure !== null) return <MateDetailFailure message={failure.message} again={again} />;
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
  return stageSpeaks(voice) ? (
    <div className="flex h-full flex-1 items-center justify-center p-8">
      <p className="text-center text-sm text-muted-foreground" role="status">
        {voice.text}
      </p>
    </div>
  ) : (
    <PageWaitLine
      delayMs={OPENING_WAIT_LINE_MS}
      from="mount"
      text={openingConversationLine(undefined)}
    />
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
  // Before the catalog names it, the Mate this browser last knew there: a reload draws its page
  // from the first frame, and the listing's word replaces it once read.
  const known =
    at.kind === "mate"
      ? at.mate
      : at.kind === "unknown"
        ? rememberedMateIdentity(environmentId)
        : undefined;
  if (known === undefined) return <MateLinkWords voice={voice} />;
  const mate = { ...known, connected: false };
  const onTryNow = voice.actions.includes("try-now") ? () => void retry(environmentId) : undefined;
  if (!stageSpeaks(voice)) {
    return (
      <MateOpeningPage
        below={
          <>
            {voice.processes && projectId !== null ? (
              <MateLinkProcesses mateServiceId={mate.serviceId} projectId={projectId} />
            ) : null}
            {onTryNow === undefined ? null : (
              <Button onClick={onTryNow} size="compact" variant="pill">
                Try now
              </Button>
            )}
          </>
        }
        composer={composer}
        // Opening, it wears the pose its container has — awake where the listing has it running,
        // as it was last known before that is read — not asleep for this page's own wait.
        mate={{ ...known, connected: mateOpeningAwake(known) }}
      />
    );
  }
  return (
    <MateComingFrame composer={composer} header={<MateComingHeader mate={mate} />}>
      <MateEmptyStateView
        coming={{
          kind: "reaching",
          below: (
            <MateLinkLine
              mateServiceId={mate.serviceId}
              onTryNow={onTryNow}
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
 * A Mate's conversation on its way: its header as the conversation draws it — the face and the
 * name, its menu and the panel toggles in their places, inert — the page quiet, one line where the
 * messages will land past its beat, and the composer standing in.
 */
function MateOpeningPage({
  mate,
  composer,
  below,
}: {
  readonly mate: ZeropsMateIdentity;
  readonly composer: ReactNode;
  readonly below: ReactNode;
}) {
  return (
    <MateComingFrame
      composer={composer}
      header={<MateComingHeader mate={mate} standsIn={{ subject: null }} />}
    >
      <PageWaitLine
        below={below}
        delayMs={OPENING_WAIT_LINE_MS}
        from="mount"
        text={openingConversationLine(mate.name)}
      />
    </MateComingFrame>
  );
}

/**
 * A Mate's own view while its conversation is on its way (a reload, before the catalog names its
 * thread or before the chat layout can draw it): its header at once, the composer standing in —
 * typed into, the conversation's own draft, which its composer reads as it takes over — and the
 * one opening line past its beat, or the link's own words where it has any.
 */
/**
 * The home's guess at where it lands — the Mate whose conversation was open last — while it works
 * it out (`homeView`): the face, the name and the opening line, with nothing that takes input, the
 * composer's place held empty; a wrong guess loses nothing typed, and gives way without motion.
 */
export function HomeOpeningView({ environmentId }: { readonly environmentId: EnvironmentId }) {
  return (
    <MateLinkStage
      composer={null}
      environmentId={environmentId}
      projectId={null}
      voice={SILENT_STAGE}
    />
  );
}

export function MateOpeningView({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const voice = useMateVoice();
  return (
    <MateLinkStage
      composer={<RouteStandIn threadRef={threadRef} />}
      environmentId={threadRef.environmentId}
      projectId={null}
      voice={voice.surface === "none" ? SILENT_STAGE : { ...voice, surface: "stage" }}
    />
  );
}
