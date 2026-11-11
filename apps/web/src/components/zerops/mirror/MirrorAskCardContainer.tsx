/**
 * A mirror ask as the conversation draws it: the engine's record of the request, the application
 * HQ places the Mate in, and HQ's repository facts, with the GitHub picker while it waits and Not
 * now, which tells the engine declined. Compact, it is the dock the conversation's watch offers
 * (`MirrorAskWatch`), which also tells the engine connected once HQ shows the remote. The card's
 * state is the engine's record and HQ's remote; this tab holds only an answer still on its way
 * (`mirrorAnswers`), which the record outranks once it says so.
 */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { hqOfferWords } from "@t3tools/client-runtime/zerops/hq";
import { HQ_REMOTE_WRITE_VERB, hqOffer } from "@t3tools/shared/hqOffers";
import { useMemo } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { useThreadDetail } from "~/state/entities";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { useMateOfEnvironment } from "~/zerops/accountEnvironments";
import { useApplicationOfProject } from "~/zerops/useGitEnvironmentFormInputs";
import { useGitMirrorApps } from "~/zerops/useGitMirrorApps";
import { useGitTargetOperations } from "~/zerops/useGitTargetOperations";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { usePersonNames } from "~/zerops/useZeropsMateOwners";
import type { AskDensity } from "../../ask/AskCard";
import { showAskInConversation } from "../../ask/askReveal";
import { ComposerAskFace } from "../../chat/ComposerAsk";
import { GithubConnectPicker, GithubConnectReading } from "../github/GithubConnectPicker";
import { NOT_NOW } from "../../ask/ask.logic";
import { Button } from "../../ui/button";
import { MirrorAskCard } from "./MirrorAskCard";
import { useMirrorAnswer, useTellMirror } from "./mirrorAnswers";
import {
  mirrorAskFromKey,
  mirrorAskKey,
  mirrorAskRowId,
  mirrorAskState,
  mirrorRemote,
} from "./mirrorAsk.logic";

export function MirrorAskCardContainer({
  requestId,
  environmentId,
  threadRef,
  density = "full",
}: {
  readonly requestId: string;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly density?: AskDensity;
}) {
  // As a string, so a change elsewhere in the thread draws nothing here.
  const key = useThreadDetail(
    threadRef,
    useMemo(
      () => (detail: { readonly activities?: unknown } | null) =>
        mirrorAskKey(detail?.activities as Parameters<typeof mirrorAskKey>[0], requestId),
      [requestId],
    ),
  );
  const ask = useMemo(() => mirrorAskFromKey(key), [key]);
  if (ask === null || environmentId === null || threadRef === null) return null;
  return (
    <MirrorAsk ask={ask} density={density} environmentId={environmentId} threadRef={threadRef} />
  );
}

function MirrorAsk({
  ask,
  density,
  environmentId,
  threadRef,
}: {
  readonly ask: NonNullable<ReturnType<typeof mirrorAskFromKey>>;
  readonly density: AskDensity;
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
}) {
  const { requestId } = ask;
  const mate = useKnownMate(environmentId);
  const mateName = mate?.name ?? "Your Mate";
  const location = useMateOfEnvironment(environmentId);
  const application = useApplicationOfProject(location?.projectId ?? mate?.projectId);
  const appId = application?.id ?? null;
  const detail = useHqAppDetail(appId);
  const repos = detail.live ? detail.repos : undefined;
  const remote = mirrorRemote(ask.repo, repos);
  const target = useGitTargetOperations(appId ?? "");
  const offer = hqOffer(target.can, HQ_REMOTE_WRITE_VERB);
  const nameOf = usePersonNames(location?.orgId ?? undefined);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const { pending, refusal } = useMirrorAnswer(requestId);
  const tell = useTellMirror(environmentId, threadRef);
  const notNow = () => void tell(requestId, { outcome: "declined" });
  const retry = () =>
    void tell(
      requestId,
      remote === null ? { outcome: "declined" } : { outcome: "connected", url: remote },
    );

  // It waits on the person while open with no remote; the conversation's watch docks it then
  // (`MirrorAskWatch`), and tells the engine once HQ shows the remote.
  const waits = ask.state === "open" && remote === null;
  const compact = density === "compact";
  // The organization's apps are read while it waits, in either size, so a dock that outlives
  // the card holds them too.
  const github = useGitMirrorApps(waits);
  if (compact && !waits) return null;
  const notNowPress = (
    <Button onClick={notNow} size="md" variant="ghost">
      {NOT_NOW}
    </Button>
  );

  return (
    <MirrorAskCard
      askId={requestId}
      density={density}
      face={compact ? <ComposerAskFace environmentId={environmentId} /> : undefined}
      mateName={mateName}
      onNotNow={notNow}
      onRetry={retry}
      picker={
        appId === null || github.apps === null ? (
          <GithubConnectReading footerEnd={notNowPress} />
        ) : (
          <GithubConnectPicker
            apps={github.apps}
            density="compact"
            footerEnd={notNowPress}
            project={appId}
            repo={ask.repo}
            returnTo={window.location.href}
          />
        )
      }
      pickerFoots
      onShowInConversation={
        compact
          ? () =>
              showAskInConversation({
                askId: requestId,
                holds: (row) => (row as { readonly id?: string }).id === mirrorAskRowId(requestId),
              })
          : undefined
      }
      reason={ask.reason}
      remoteUrl={remote}
      repo={ask.repo}
      state={mirrorAskState({
        state: ask.state,
        pending,
        refusal,
        remote,
        refused: offer.kind === "refused" ? (hqOfferWords(offer) ?? null) : null,
        mateName,
        by: ask.answeredBy === null ? null : (nameOf(ask.answeredBy) ?? null),
        at:
          ask.answeredAt === null
            ? null
            : formatDayAwareTimestamp(new Date(ask.answeredAt).toISOString(), timestampFormat),
      })}
    />
  );
}
