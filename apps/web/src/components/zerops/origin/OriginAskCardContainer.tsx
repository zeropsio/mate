/**
 * An origin question as the conversation draws it: the engine's records of the requests it stands
 * for — one per address at a time (`originAskPlaces`): a Mate with several dev services from one
 * repository asks once for each —, the application HQ places the Mate in (whose repositories the
 * GitHub app mounts) and the pick — on GitHub once HQ mounts every asked repository, from the
 * card's sheet or anywhere else, or in Mate on its press, once HQ follows each GitHub repository
 * or leaves its follow to an owner or admin — only the pick reaches the engine, for every ask
 * still open. The card's state is the engine's records and HQ's mount; this tab holds only a pick
 * still on its way, which the record outranks once it says so.
 */
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { OperationStopped } from "@t3tools/client-runtime/data";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useThreadDetail } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useMateOfEnvironment } from "~/zerops/accountEnvironments";
import { useApplicationOfProject } from "~/zerops/useGitEnvironmentFormInputs";
import { useGitMirrorApps } from "~/zerops/useGitMirrorApps";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { hqOfferWords } from "@t3tools/client-runtime/zerops/hq";
import { HQ_REMOTE_WRITE_VERB, hqOffer } from "@t3tools/shared/hqOffers";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import { useGitTargetOperations } from "~/zerops/useGitTargetOperations";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { usePersonNames } from "~/zerops/useZeropsMateOwners";
import { useClientSettings } from "~/hooks/useSettings";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { OriginAskCard } from "./OriginAskCard";
import {
  type OriginAskOfRequest,
  type OriginAskSaid,
  originAnswerSettled,
  originAskAnswer,
  originAskState,
  originAskGroup,
  originAsksFromKey,
  originAsksKey,
  keepInMate,
  originAskOf,
  originConnected,
  originGithubApp,
} from "./originAsk.logic";

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
  const mate = useKnownMate(environmentId);
  const location = useMateOfEnvironment(environmentId);
  const application = useApplicationOfProject(location?.projectId ?? mate?.projectId);
  const appId = application?.id ?? null;
  const detail = useHqAppDetail(appId);
  const repos = detail.live ? detail.repos : undefined;
  const target = useGitTargetOperations(appId ?? "");
  const offer = hqOffer(target.can, HQ_REMOTE_WRITE_VERB);
  const viaApp = target.actions?.viaApp;
  const follow = appId === null ? undefined : target.actions?.follow;
  // The apps are read while the GitHub way can still be picked.
  const github = useGitMirrorApps(ask.state === "open");
  const session = useZeropsSession();
  const { app, githubAppId } = originGithubApp(github.apps, ask.url, session.user?.id ?? null);
  const admin = roleAtLeast(session.activeOrganization?.roleCode, "ADMIN");
  const navigate = useNavigate();
  // A pick on its way: the engine's record outranks it once it says so.
  const [pending, setPending] = useState<OriginAskSaid | null>(null);
  const pendingRef = useRef<OriginAskSaid | null>(null);
  const nameOf = usePersonNames(location?.orgId ?? undefined);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const answerOriginAsk = useAtomCommand(threadEnvironment.answerOriginAsk, {
    reportFailure: false,
  });
  const tell = useCallback(
    async (outcome: OriginAskSaid): Promise<string | null> => {
      // The sheet's production and HQ's record both answer connected: the engine hears it once.
      if (pendingRef.current === outcome) return null;
      pendingRef.current = outcome;
      setPending(outcome);
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
        pendingRef.current = null;
        setPending(null);
        return error instanceof Error ? error.message : "The Mate did not take the answer.";
      }
      return null;
    },
    [answerOriginAsk, environmentId, open, threadRef.threadId],
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
  const due = originAskAnswer(ask.state, pending, connected);
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
              app,
              repos,
              mountable: offer.kind === "allowed" && viaApp !== undefined,
              refusal: hqOfferWords(offer),
              onMount: async (repository) => {
                if (viaApp === undefined) return "HQ doesn't let you connect a repository here.";
                try {
                  // Each repository the asks name, through the app, to the one GitHub repository.
                  for (const repo of unmounted)
                    await viaApp(repo, repository, githubAppId ?? undefined);
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
              onInstall: () => {
                if (app?.kind === "connected" && app.appId !== undefined)
                  void github.install(app.appId);
              },
            }
      }
      mateName={mate?.name ?? "Your Mate"}
      onAnswer={onAnswer}
      state={originAskState({
        state: ask.state,
        pending,
        connected,
        url: ask.url,
        mateName: mate?.name ?? "Your Mate",
        by: group.answered.by === null ? null : (nameOf(group.answered.by) ?? null),
        at:
          group.answered.at === null
            ? null
            : formatDayAwareTimestamp(new Date(group.answered.at).toISOString(), timestampFormat),
      })}
    />
  );
}
