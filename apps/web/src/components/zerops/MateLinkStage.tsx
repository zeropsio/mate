/**
 * A Mate's page while its conversation cannot show yet (a reload before the catalog names its
 * thread, the route's link being made, the Mate down): its header — the face and the name — as its
 * conversation will draw it, awake where its container runs; until the directory names who lives
 * there, the header's place held empty, never a guess. Opening, the
 * page under it is quiet, with one headline where the conversation will open; where the link
 * has words of its own (a restart, a reconnect, a container that is not running) the Mate's face
 * stands asleep over its name with them, on one axis (`stageSpeaks`).
 */
import { ConversationOpeningStage } from "../chat/ConversationOpeningStage";
import { askAgainLabel } from "@t3tools/client-runtime/zerops/environments";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { useMateDetailRead, useTryMateAgain } from "~/zerops/accountEnvironments";
import { MateDetailFailure } from "./MateDetailFailure";

import { useMateVoice } from "~/zerops/mateVoiceContext";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import { MateLinkLine, type Spoken } from "./MateLinkLine";
import { RouteStandIn } from "./RouteStandIn";
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
  /** What stands where its conversation's composer will (`ConversationFooterStandIn`). */
  readonly composer?: ReactNode;
}) {
  const { failure, again } = useMateDetailRead(projectId, environmentId);
  if (environmentId === null && failure !== null)
    return <MateDetailFailure message={failure.message} again={again} />;
  return environmentId === null ? (
    <MateLinkWords voice={voice} />
  ) : (
    <MateLinkStageOf
      composer={composer}
      failure={failure}
      again={again}
      environmentId={environmentId}
      projectId={projectId}
      voice={voice}
    />
  );
}

function MateLinkWords({ voice }: { readonly voice: Spoken }) {
  return (
    <MateEmptyStateView
      coming={{
        kind: "reaching",
        face: voice.text === null ? "sleep" : voice.face,
        severity: voice.severity,
        headline: voice.headline ?? voice.text ?? "The Mate is opening the conversation.",
        sentence: voice.secondary ?? "Picking up where you left off.",
        below: null,
      }}
      mate={null}
      phase={null}
      signIn={null}
      signInRequired={false}
      unknown={null}
    />
  );
}

function MateLinkStageOf({
  failure,
  again,
  environmentId,
  voice,
  projectId,
  composer,
}: {
  readonly environmentId: EnvironmentId;
  readonly voice: Spoken;
  readonly projectId: string | null;
  readonly composer: ReactNode;
  readonly failure: { readonly message: string } | null;
  readonly again: () => void;
}) {
  const at = useZeropsMate(environmentId);
  // Try now asks its Mate again, its exchange as well as its link, as the banner's does.
  const tryAgain = useTryMateAgain();
  if (at.kind === "nobody" && failure === null) return <MateLinkWords voice={voice} />;
  // Before the directory names who lives here, the stage is the named one's with the face, the
  // name and the header's place held: its verbs, its processes and its words need
  // no name, and nothing moves when the name arrives.
  const known = at.kind === "mate" ? at.mate : null;
  const askAgain = askAgainLabel(voice.actions);
  const onTryNow = askAgain === null ? undefined : () => tryAgain(environmentId);
  const mate = known === null ? null : { ...known, connected: false };
  if (failure !== null)
    return (
      <MateComingFrame
        composer={composer}
        header={mate === null ? null : <MateComingHeader mate={mate} />}
      >
        <MateDetailFailure mate={mate} message={failure.message} again={again} />
      </MateComingFrame>
    );
  return (
    <MateComingFrame
      composer={composer}
      header={mate === null ? null : <MateComingHeader mate={mate} />}
    >
      {voice.opening === true ||
      (voice.text === null &&
        !voice.processes &&
        voice.actions.length === 0 &&
        voice.restarting !== true) ? (
        <ConversationOpeningStage ready={false} name={known?.name} mate={mate} />
      ) : (
        <MateEmptyStateView
          coming={{
            kind: "reaching",
            face: voice.text === null ? "sleep" : voice.face,
            severity: voice.severity,
            headline:
              voice.headline ??
              voice.text ??
              `${known?.name || "The Mate"} is opening the conversation.`,
            sentence: voice.secondary,
            restarting: voice.restarting === true,
            restartLines: voice.restartLines,
            below: (
              <MateLinkLine
                mateServiceId={mate?.serviceId}
                onTryNow={onTryNow}
                projectId={projectId}
                projectUrl={
                  mate?.projectUrl ?? (projectId === null ? undefined : zeropsProjectUrl(projectId))
                }
                voice={{ ...voice, text: null }}
              />
            ),
          }}
          mate={mate}
          phase={null}
          signIn={null}
          signInRequired={false}
          unknown={null}
        />
      )}
    </MateComingFrame>
  );
}

/**
 * A Mate's own view while its conversation is on its way (a reload, before the catalog names its
 * thread or before the chat layout can draw it): its header's place at once, the composer's room
 * held at its draft's height, with the opening line or the link's own words
 * where it has any.
 */
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
