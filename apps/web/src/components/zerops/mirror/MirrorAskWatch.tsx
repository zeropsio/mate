/**
 * The conversation's watch over its open mirror asks, drawn or not: their cards may stand far
 * above the end, unmounted by the list. HQ showing an asked repository's remote — set from the
 * card, the project's page or anywhere else — tells the engine connected, once per request. The
 * newest ask still waiting on the person docks above the composer. Back from GitHub's install
 * page for an asked repository, the conversation shows that ask's card, whose picker marks what
 * the trip added. Draws nothing itself.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { useThreadDetail } from "~/state/entities";
import { useMateOfEnvironment } from "~/zerops/accountEnvironments";
import { useApplicationOfProject } from "~/zerops/useGitEnvironmentFormInputs";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { dockAsk, showAskInConversation, undockAsk } from "../../ask/askReveal";
import { rememberSeen, SEEN_PARAM } from "../github/githubConnect.logic";
import { mirrorDeclinePending, useTellMirror } from "./mirrorAnswers";
import {
  mirrorAskRowId,
  mirrorOpenAsks,
  mirrorOpenAsksKey,
  mirrorRemote,
  seenRepo,
} from "./mirrorAsk.logic";
import { MirrorAskCardContainer } from "./MirrorAskCardContainer";

const selectOpenKey = (detail: { readonly activities?: unknown } | null): string =>
  mirrorOpenAsksKey(detail?.activities as Parameters<typeof mirrorOpenAsksKey>[0]);

export function MirrorAskWatch({ threadRef }: { readonly threadRef: ScopedThreadRef | null }) {
  // As a string, so a change elsewhere in the thread draws nothing here.
  const key = useThreadDetail(threadRef, selectOpenKey);
  if (key === "" || threadRef === null) return null;
  return <Watch openKey={key} threadRef={threadRef} />;
}

function Watch({
  openKey,
  threadRef,
}: {
  readonly openKey: string;
  readonly threadRef: ScopedThreadRef;
}) {
  const environmentId: EnvironmentId = threadRef.environmentId;
  const open = useMemo(() => mirrorOpenAsks(openKey), [openKey]);
  const mate = useKnownMate(environmentId);
  const location = useMateOfEnvironment(environmentId);
  const application = useApplicationOfProject(location?.projectId ?? mate?.projectId);
  const detail = useHqAppDetail(application?.id ?? null);
  const repos = detail.live ? detail.repos : undefined;
  const tell = useTellMirror(environmentId, threadRef);

  // HQ's remote answers each open ask once, unless the person's Not now is on its way.
  useEffect(() => {
    for (const ask of open) {
      const remote = mirrorRemote(ask.repo, repos);
      if (remote === null || mirrorDeclinePending(ask.requestId)) continue;
      void tell(ask.requestId, { outcome: "connected", url: remote }, true);
    }
  }, [open, repos, tell]);

  // The newest ask HQ shows no remote for docks; the one docked before it goes.
  const threadKey = scopedThreadKey(threadRef);
  const waiting = open.findLast((ask) => mirrorRemote(ask.repo, repos) === null)?.requestId;
  const docked = useRef<string | null>(null);
  useEffect(() => {
    if (docked.current !== null && docked.current !== waiting) {
      undockAsk(threadKey, docked.current);
    }
    docked.current = waiting ?? null;
    if (waiting === undefined) return;
    dockAsk(threadKey, {
      askId: waiting,
      render: () => (
        <MirrorAskCardContainer
          density="compact"
          environmentId={environmentId}
          key={waiting}
          requestId={waiting}
          threadRef={threadRef}
        />
      ),
    });
  }, [environmentId, threadKey, threadRef, waiting]);
  useEffect(
    () => () => {
      if (docked.current !== null) undockAsk(threadKey, docked.current);
    },
    [threadKey],
  );

  // Back from GitHub's install page, the asked repository's card is shown, once.
  const [returned] = useState(() => {
    const value = new URL(window.location.href).searchParams.get(SEEN_PARAM);
    rememberSeen(value);
    return seenRepo(value);
  });
  const shown = useRef(false);
  const returnedTo = open.findLast((ask) => ask.repo === returned)?.requestId;
  useEffect(() => {
    if (returnedTo === undefined || shown.current) return;
    shown.current = true;
    showAskInConversation({
      askId: returnedTo,
      holds: (row) => (row as { readonly id?: string }).id === mirrorAskRowId(returnedTo),
    });
  }, [returnedTo]);
  return null;
}
