/**
 * A mirror ask as the conversation draws it: the engine's record of the request, the application
 * HQ places the Mate in, and HQ's repository facts. Once HQ shows the asked repository's remote —
 * set from the card's picker or anywhere else — the engine hears connected, at that address; Not
 * now tells it declined. While it waits on the person it stands above the composer too, once its
 * card is out of view. The card's state is the engine's record and HQ's remote; this tab holds only
 * an answer still on its way, which the record outranks once it says so.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { HQ_REMOTE_WRITE_VERB } from "@t3tools/shared/hqOffers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { useThreadDetail } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { useMateOfEnvironment } from "~/zerops/accountEnvironments";
import { useApplicationOfProject } from "~/zerops/useGitEnvironmentFormInputs";
import { useGitMirrorApps } from "~/zerops/useGitMirrorApps";
import { useGitTargetOperations } from "~/zerops/useGitTargetOperations";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { useHqOffers } from "~/zerops/useHqOffers";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { usePersonNames } from "~/zerops/useZeropsMateOwners";
import type { AskDensity } from "../../ask/AskCard";
import { dockAsk, showAskInConversation, undockAsk } from "../../ask/askReveal";
import { ComposerAskFace } from "../../chat/ComposerAsk";
import { GithubConnectPicker } from "../github/GithubConnectPicker";
import { MirrorAskCard } from "./MirrorAskCard";
import {
  type MirrorAskPending,
  mirrorAnswerSettled,
  mirrorAskAnswer,
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
  const hqOffers = useHqOffers();
  const offer = hqOffers.state(target.can, HQ_REMOTE_WRITE_VERB);
  const nameOf = usePersonNames(location?.orgId ?? undefined);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  // An answer on its way, and the engine's refusal of it: the record outranks both once it says.
  const [pending, setPending] = useState<MirrorAskPending>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const pendingRef = useRef<MirrorAskPending>(null);
  const answerMirrorAsk = useAtomCommand(threadEnvironment.answerMirrorAsk, {
    reportFailure: false,
  });
  const tell = useCallback(
    async (
      said:
        | { readonly outcome: "connected"; readonly url: string }
        | { readonly outcome: "declined" },
    ) => {
      if (pendingRef.current === said.outcome) return;
      pendingRef.current = said.outcome;
      setPending(said.outcome);
      setRefusal(null);
      const result = await answerMirrorAsk({
        environmentId,
        input: { threadId: threadRef.threadId, requestId, ...said },
      });
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      // Settled by its Mate (or answered) meanwhile: nothing left to tell it.
      if (mirrorAnswerSettled(error)) return;
      pendingRef.current = null;
      setPending(null);
      setRefusal(error instanceof Error ? error.message : "The Mate did not take the answer.");
    },
    [answerMirrorAsk, environmentId, requestId, threadRef.threadId],
  );
  // HQ showing the repository's remote, from the picker or anywhere else, answers once here; a
  // refusal waits for Try again.
  const due = mirrorAskAnswer(ask.state, pending, remote);
  const answered = useRef(false);
  useEffect(() => {
    if (due === null || answered.current) return;
    answered.current = true;
    void tell({ outcome: "connected", url: due });
  }, [due, tell]);
  const notNow = () => void tell({ outcome: "declined" });
  const retry = () =>
    void tell(remote === null ? { outcome: "declined" } : { outcome: "connected", url: remote });

  // It waits on the person while open with no remote: then it stands above the composer too.
  const waits = ask.state === "open" && remote === null;
  const compact = density === "compact";
  // The organization's apps are read while the card's picker can still connect it.
  const github = useGitMirrorApps(waits && !compact);
  const threadKey = scopedThreadKey(threadRef);
  useEffect(() => {
    if (!waits) {
      undockAsk(threadKey, requestId);
      return;
    }
    if (compact) return;
    dockAsk(threadKey, {
      askId: requestId,
      render: () => (
        <MirrorAskCardContainer
          density="compact"
          environmentId={environmentId}
          requestId={requestId}
          threadRef={threadRef}
        />
      ),
    });
  }, [compact, environmentId, requestId, threadKey, threadRef, waits]);
  if (compact && !waits) return null;

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
          <p className="text-body text-muted-foreground">Reading your organization's GitHub…</p>
        ) : (
          <GithubConnectPicker
            apps={github.apps}
            density="compact"
            project={appId}
            repo={ask.repo}
          />
        )
      }
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
        refused: offer.kind === "refused" ? (hqOffers.words(offer) ?? null) : null,
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
