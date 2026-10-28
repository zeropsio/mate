/**
 * An origin question as the conversation draws it: the engine's records of the requests it stands
 * for — one per address at a time (`originAskPlaces`): a Mate with several dev services from one
 * repository asks once for each —, the application HQ places the Mate in (whose repositories the
 * GitHub app mounts) and the pick — on GitHub once HQ mounts every asked repository, from the
 * card's sheet or anywhere else, or in Mate on its press, once HQ follows each GitHub repository
 * or leaves its follow to an owner or admin — only the pick reaches the engine, for every ask
 * still open. What the person picked here is kept in memory by the card's first request, so the
 * card folds at once and stays folded until the engine's records say so too.
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
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import { useGitTargetOperations } from "~/zerops/useGitTargetOperations";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { useHqOffers } from "~/zerops/useHqOffers";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { OriginAskCard } from "./OriginAskCard";
import {
  type OriginAskOfRequest,
  type OriginAskSaid,
  originAnswerSettled,
  originAskAnswer,
  originAskFace,
  originAskGroup,
  originAsksFromKey,
  originAsksKey,
  keepInMate,
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
  requestIds,
  environmentId,
  threadRef,
}: {
  readonly requestIds: ReadonlyArray<string>;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
}) {
  // As a string, so a change elsewhere in the thread draws nothing here.
  const requests = requestIds.join("\n");
  const asksKey = useThreadDetail(
    threadRef,
    useMemo(
      () => (detail: { readonly activities?: unknown } | null) =>
        originAsksKey(
          requests
            .split("\n")
            .map((requestId) =>
              originAskOf(detail?.activities as Parameters<typeof originAskOf>[0], requestId),
            ),
        ),
      [requests],
    ),
  );
  const asks = useMemo(() => originAsksFromKey(asksKey), [asksKey]);
  if (asks.length === 0 || environmentId === null || threadRef === null) return null;
  return <AskCard asks={asks} environmentId={environmentId} threadRef={threadRef} />;
}

function AskCard({
  asks,
  environmentId,
  threadRef,
}: {
  readonly asks: ReadonlyArray<OriginAskOfRequest>;
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
}) {
  const group = useMemo(() => originAskGroup(asks), [asks]);
  const { ask, open, repos: asked } = group;
  // The card's memory of the pick: its first request's.
  const requestId = asks[0]?.requestId ?? "";
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
  const follow = appId === null ? undefined : target.actions?.follow;
  // The app is read while the GitHub way can still be picked.
  const github = useGitMirrorApp(ask.state === "open");
  const admin = roleAtLeast(useZeropsSession().activeOrganization?.roleCode, "ADMIN");
  const navigate = useNavigate();
  const said = useOriginAskSaid((state) => state[requestId] ?? null);
  const answerOriginAsk = useAtomCommand(threadEnvironment.answerOriginAsk, {
    reportFailure: false,
  });
  const tell = useCallback(
    async (outcome: OriginAskSaid): Promise<string | null> => {
      // The sheet's production and HQ's record both answer connected: the engine hears it once.
      if (useOriginAskSaid.getState()[requestId] === outcome) return null;
      say(requestId, outcome);
      // Every ask the card stands for that is still open hears the one pick.
      for (const each of open) {
        const result = await answerOriginAsk({
          environmentId,
          input: { threadId: threadRef.threadId, requestId: each, outcome },
        });
        if (result._tag === "Success" || isAtomCommandInterrupted(result)) continue;
        const error = squashAtomCommandFailure(result);
        // Settled by its Mate (or answered) meanwhile: nothing left to tell it.
        if (originAnswerSettled(error)) continue;
        say(requestId, null);
        return error instanceof Error ? error.message : "The Mate did not take the answer.";
      }
      return null;
    },
    [answerOriginAsk, environmentId, open, requestId, threadRef.threadId],
  );
  const onAnswer = useCallback(
    (outcome: OriginAskSaid): Promise<string | null> =>
      outcome === "connected"
        ? tell(outcome)
        : keepInMate(
            ask.url,
            // HQ follows on the same verdict it connects on.
            offer.kind === "refused"
              ? "owner-or-admin"
              : follow === undefined
                ? undefined
                : async (url) => {
                    try {
                      // Each repository the asks name follows the one address.
                      for (const repo of asked) await follow(repo, url);
                      return null;
                    } catch (cause) {
                      return cause instanceof OperationStopped
                        ? cause.message
                        : "HQ couldn't confirm it follows the repository. Check it before trying again.";
                    }
                  },
            () => tell(outcome),
          ),
    [ask.url, asked, follow, offer.kind, tell],
  );
  const connected = group.connected(repos);
  // The repositories HQ does not mount yet: the sheet speaks of the first, and mounts them all.
  const unmounted = asked.filter((repo) => !originConnected({ url: ask.url, repo }, repos));
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
      ask={unmounted[0] === undefined ? ask : { ...ask, repo: unmounted[0] }}
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
                  // Each repository the asks name, through the app, to the one GitHub repository.
                  for (const repo of unmounted) await viaApp(repo, repository);
                  return null;
                } catch (cause) {
                  return cause instanceof OperationStopped
                    ? cause.message
                    : "HQ couldn't confirm the repository. Check it before trying again.";
                }
              },
              onCheckAgain: github.again,
              onOpenAutomation: () => void navigate({ to: "/settings/automation" }),
              admin,
              onInstall: github.install,
            }
      }
      face={originAskFace(ask.state, said, connected)}
      mateName={mate?.name ?? "Your Mate"}
      onAnswer={onAnswer}
    />
  );
}
