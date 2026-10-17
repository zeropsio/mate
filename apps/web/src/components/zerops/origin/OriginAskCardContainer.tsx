/**
 * An origin ask as the conversation draws it: the engine's record of the request, the application
 * HQ places the Mate in (where the Git sheet adds the environments) and the answer, connected once
 * production is added or declined on Not now — only the outcome reaches the engine. What the
 * person said here is kept in memory by the request, so the card folds at once and stays folded
 * until the engine's record says so too.
 */
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";
import { create } from "zustand";

import { useThreadDetail } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAccountOrgId } from "~/zerops/accountData";
import { useMateOfEnvironment } from "~/zerops/accountEnvironments";
import {
  useApplicationOfProject,
  useGitEnvironmentFormInputs,
} from "~/zerops/useGitEnvironmentFormInputs";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { OriginAskCard } from "./OriginAskCard";
import {
  type OriginAsk,
  type OriginAskSaid,
  originAskFace,
  originAskFromKey,
  originAskKey,
  originAskOf,
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
  const git = useGitEnvironmentFormInputs(useAccountOrgId(), application?.id ?? null);
  const said = useOriginAskSaid((state) => state[requestId] ?? null);
  const answerOriginAsk = useAtomCommand(threadEnvironment.answerOriginAsk, {
    reportFailure: false,
  });
  const onAnswer = useCallback(
    async (outcome: OriginAskSaid): Promise<string | null> => {
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
  return (
    <OriginAskCard
      application={
        application === undefined || git === undefined ? undefined : { name: application.name, git }
      }
      ask={ask}
      face={originAskFace(ask.state, said)}
      mateName={mate?.name ?? "Your Mate"}
      onAnswer={onAnswer}
    />
  );
}
