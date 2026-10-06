/**
 * How the left menu reads each Mate it draws: what its row says (`useMateRowActivity` — HQ's word
 * of it or its socket's reading, live while either stands, at rest otherwise) and
 * whether it is still in its first minutes (`mateComing` — its birth, its project on the way up,
 * the platform's verdict on its creation, this tab's creation). The menu, the folded headings and
 * the waiting faces read the same answers; the projects page reads the same words.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  applyProjectCreationVerdict,
  type ZeropsCandidate,
} from "@t3tools/client-runtime/zerops/candidates";
import { useCallback, useMemo } from "react";

import { environmentsWithSnapshotAtom } from "../state/shell";
import { hqMatesAtom, zeropsEnvironmentsAtom } from "../state/zerops";
import { overviewAgentActivity, type ZeropsAgentActivity } from "./agentActivity";
import { useEnvironmentLinks } from "../routes/-environmentTargets";
import { arrivalAwaitsAnswer, arrivalLinkHolds, mateComing, type MateComing } from "./mateComing";
import { useCreations } from "./creations";
import { madeOf } from "./newProjectBirth";
import { useProjectCreations } from "./useProjectCreations";
import { useCloseOffHolds } from "./accountEnvironments";
import { useZeropsFirstBuilds } from "./useZeropsFirstBuilds";
import { usePressesElsewhere } from "./usePressesElsewhere";
import { closeOffOpenOf, pressComingInput, useMatePresses } from "./matePress";

/**
 * What a Mate's row says (`useZeropsAgentActivity`), found by its project: through HQ's word of it,
 * else through its connected socket's environment, else through the socket whose server says it
 * runs that project — a reconnecting socket leaves the candidate `ready`.
 */
export function useMateActivityByProject(
  activity: ReadonlyMap<EnvironmentId, ZeropsAgentActivity>,
): (projectId: string, connected: EnvironmentId | undefined) => ZeropsAgentActivity | undefined {
  const environments = useAtomValue(zeropsEnvironmentsAtom);
  const hq = useAtomValue(hqMatesAtom);
  const sockets = useMemo(
    () =>
      new Map(
        environments.flatMap((environment) =>
          typeof environment.zeropsProjectId === "string"
            ? [[environment.zeropsProjectId, environment.environmentId] as const]
            : [],
        ),
      ),
    [environments],
  );
  return useCallback(
    (projectId: string, connected: EnvironmentId | undefined) => {
      const environmentId =
        hq?.mates?.get(projectId)?.identity?.environmentId ?? connected ?? sockets.get(projectId);
      return environmentId === undefined ? undefined : activity.get(environmentId);
    },
    [activity, hq, sockets],
  );
}

/** What a Mate's row says (`useMateActivityByProject`), for a candidate the menu lists. */
export function useMateRowActivity(
  activity: ReadonlyMap<EnvironmentId, ZeropsAgentActivity>,
): (candidate: ZeropsCandidate) => ZeropsAgentActivity | undefined {
  const byProject = useMateActivityByProject(activity);
  return useCallback(
    (candidate: ZeropsCandidate) =>
      byProject(
        candidate.project.id,
        candidate.group === "connected" ? candidate.environmentId : undefined,
      ),
    [byProject],
  );
}

/**
 * The main chat HQ names for each Mate, by its project — its overview's main chat in its
 * environment: what opening a Mate this page holds no socket to routes to, the route connecting it.
 */
export function useHqMainChats(): (projectId: string) => ScopedThreadRef | undefined {
  const hq = useAtomValue(hqMatesAtom);
  return useCallback(
    (projectId: string) => {
      const told = hq?.mates?.get(projectId);
      return told?.identity === undefined || !told.main
        ? undefined
        : scopeThreadRef(told.identity.environmentId, told.main.id);
    },
    [hq],
  );
}

/**
 * What HQ last told of a Mate, as its menu row reads it, at rest — the conversation its row stands
 * for and what it is on; undefined where HQ holds no overview of it, or it has no main chat yet.
 */
export function useToldActivity(projectId: string): ZeropsAgentActivity | undefined {
  const told = useAtomValue(hqMatesAtom)?.mates?.get(projectId);
  return useMemo(
    () => (told === undefined ? undefined : overviewAgentActivity(told, false, {})),
    [told],
  );
}

/**
 * Whether a Mate's conversations have been read — HQ told of them, or its connected environment's
 * shell arrived — so a Mate with none has nothing asked yet, and its row may say so without taking
 * it back.
 */
export function useMateConversationsRead(): (candidate: ZeropsCandidate) => boolean {
  const read = useAtomValue(environmentsWithSnapshotAtom);
  const hq = useAtomValue(hqMatesAtom);
  return useCallback(
    (candidate: ZeropsCandidate) =>
      hq?.mates?.get(candidate.project.id)?.main !== undefined ||
      (candidate.group === "connected" &&
        candidate.environmentId !== undefined &&
        read.has(candidate.environmentId)),
    [hq, read],
  );
}

/**
 * Whether a Mate the menu lists is still in its first minutes, as its row says it: its press made
 * in this browser, its project on the way up, its address landed and its Mate not answering yet,
 * the platform's verdict on its creation and its first build's process (read as the projects page
 * reads them), its press in another browser as HQ holds it, or a step of this tab's creation that
 * failed.
 */
export function useMateComingOf(
  candidates: ReadonlyArray<ZeropsCandidate>,
): (candidate: ZeropsCandidate) => MateComing | undefined {
  const presses = useMatePresses();
  const creations = useCreations();
  const { mateLink } = useEnvironmentLinks();
  const closeOffHolds = useCloseOffHolds();
  const verdicts = useProjectCreations(candidates);
  const firstBuilds = useZeropsFirstBuilds(candidates);
  const pressOf = usePressesElsewhere(candidates);
  return useCallback(
    (candidate: ZeropsCandidate) => {
      const { press, setUpFailed } = pressComingInput(presses, candidate.project.id);
      // Made here, and not connected since.
      const created =
        candidate.group !== "connected" && madeOf(creations, candidate.project.id) !== undefined;
      return mateComing({
        press,
        // A row says only the hold it offers Finish setup for; the others, its own view.
        closeOffHold: closeOffOpenOf(
          closeOffHolds,
          candidate.project.id,
          presses.find((entry) => entry.projectId === candidate.project.id),
        )
          ? "open"
          : undefined,
        candidate: applyProjectCreationVerdict(candidate, verdicts.get(candidate.project.id)),
        setUpFailed,
        nowMs: Date.now(),
        created,
        linkHolds: created ? arrivalLinkHolds(mateLink(candidate)) : undefined,
        answerAwaited:
          candidate.arriving === undefined ? undefined : arrivalAwaitsAnswer(mateLink(candidate)),
        firstBuild: firstBuilds.get(candidate.key),
        pressElsewhere: pressOf(candidate.project.id),
      });
    },
    [presses, creations, firstBuilds, mateLink, pressOf, verdicts, closeOffHolds],
  );
}
