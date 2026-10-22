/**
 * An origin ask as the conversation draws it: the engine's record of the request, the application
 * HQ places the Mate in (whose repository the GitHub app mounts) and the pick — on GitHub once HQ
 * mounts the asked repository, from the card's sheet or anywhere else, or in Mate on its press —
 * only the pick reaches the engine. What the person picked here is kept in memory by the request,
 * so the card folds at once and stays folded until the engine's record says so too.
 */
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { OperationStopped } from "@t3tools/client-runtime/data";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { create } from "zustand";

import { useThreadDetail } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useMateOfEnvironment } from "~/zerops/accountEnvironments";
import { useApplicationOfProject } from "~/zerops/useGitEnvironmentFormInputs";
import { useGitMirrorApp } from "~/zerops/useGitMirrorApp";
import { useGitTargetOperations } from "~/zerops/useGitTargetOperations";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { useHqOffers } from "~/zerops/useHqOffers";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { OriginAskCard } from "./OriginAskCard";
import {
  type OriginAsk,
  type OriginAskSaid,
  originAskAnswer,
  originAskFace,
  originAskFromKey,
  originAskKey,
  originAskOf,
  originConnected,
} from "./originAsk.logic";

/** What the person said to each ask here, by its request. Memory only. */
const useOriginAskSaid = create<Readonly<Record<string, OriginAskSaid>>>()(() => ({}));

const say = (requestId: string, said: OriginAskSaid | null) =>
  useOriginAskSaid.setState((state) => {
    if (said !== null) return { ...state, [requestId]: said };
    const { [requestId]: _gone, ...rest } = state;
    return rest;
  });

export function OriginAskCardContainer({
  requestId,
  environmentId,
  threadRef,
}: {
  readonly requestId: string;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
}) {
  // As a string, so a change elsewhere in the thread draws nothing here.
  const askKey = useThreadDetail(
    threadRef,
    useMemo(
      () => (detail: { readonly activities?: unknown } | null) =>
        originAskKey(
          originAskOf(detail?.activities as Parameters<typeof originAskOf>[0], requestId),
        ),
      [requestId],
    ),
  );
  const ask = useMemo(() => originAskFromKey(askKey), [askKey]);
  if (ask === null || environmentId === null || threadRef === null) return null;
  return (
    <AskCard ask={ask} environmentId={environmentId} requestId={requestId} threadRef={threadRef} />
  );
}

function AskCard({
  ask,
  environmentId,
  requestId,
  threadRef,
}: {
  readonly ask: OriginAsk;
  readonly environmentId: EnvironmentId;
  readonly requestId: string;
  readonly threadRef: ScopedThreadRef;
}) {
  const mate = useKnownMate(environmentId);
  const location = useMateOfEnvironment(environmentId);
  const application = useApplicationOfProject(location?.projectId ?? mate?.projectId);
  const appId = application?.id ?? null;
  const detail = useHqAppDetail(appId);
  const repos = detail.live ? detail.repos : undefined;
  const target = useGitTargetOperations(appId ?? "");
  const hqOffers = useHqOffers();
  const offer = hqOffers.state(target.can, "connect_remote");
  const viaApp = target.actions?.viaApp;
  // The app is read while the GitHub way can still be picked.
  const github = useGitMirrorApp(ask.state === "open");
  const navigate = useNavigate();
  const said = useOriginAskSaid((state) => state[requestId] ?? null);
  const answerOriginAsk = useAtomCommand(threadEnvironment.answerOriginAsk, {
    reportFailure: false,
  });
  const onAnswer = useCallback(
    async (outcome: OriginAskSaid): Promise<string | null> => {
      // The sheet's production and HQ's record both answer connected: the engine hears it once.
      if (useOriginAskSaid.getState()[requestId] === outcome) return null;
      say(requestId, outcome);
      const result = await answerOriginAsk({
        environmentId,
        input: { threadId: threadRef.threadId, requestId, outcome },
      });
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) return null;
      say(requestId, null);
      const error = squashAtomCommandFailure(result);
      return error instanceof Error ? error.message : "The Mate did not take the answer.";
    },
    [answerOriginAsk, environmentId, requestId, threadRef.threadId],
  );
  const connected = originConnected(ask, repos);
  // HQ mounting the asked repository, from the sheet or anywhere else, answers once here.
  const due = originAskAnswer(ask.state, said, connected);
  const answered = useRef(false);
  useEffect(() => {
    if (due === null || answered.current) return;
    answered.current = true;
    void onAnswer(due);
  }, [due, onAnswer]);
  return (
    <OriginAskCard
      ask={ask}
      github={
        appId === null
          ? undefined
          : {
              app: github.app,
              repos,
              mountable: offer.kind === "allowed" && viaApp !== undefined,
              refusal: hqOffers.words(offer),
              onMount: async (repository) => {
                if (viaApp === undefined) return "HQ doesn't let you connect a repository here.";
                try {
                  await viaApp(ask.repo, repository);
                  return null;
                } catch (cause) {
                  return cause instanceof OperationStopped
                    ? cause.message
                    : "HQ couldn't confirm the repository. Check it before trying again.";
                }
              },
              onCheckAgain: github.again,
              onOpenAutomation: () => void navigate({ to: "/settings/automation" }),
            }
      }
      face={originAskFace(ask.state, said, connected)}
      mateName={mate?.name ?? "Your Mate"}
      onAnswer={onAnswer}
    />
  );
}
