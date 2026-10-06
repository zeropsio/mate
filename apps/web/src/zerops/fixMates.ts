/**
 * Which Mates a problem's fix is offered to (S6): the person's own Mates in
 * the project the problem is in — a Mate nobody can say is someone else's
 * counts as theirs, as the menu's *Mine* keeps it — the one they used last
 * first. Nobody writes to a colleague's Mate, so a colleague's conversation
 * with none of the person's own Mates in its project offers nothing. Only a
 * Mate the app is connected to is offered: the words go into its
 * conversation's composer, and one not connected has none to take them.
 */
import { useAtomValue } from "@effect/atom-react";
import { shownHqPersonFactsAtom } from "@t3tools/client-runtime/data";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { projectNameInApp, readZeropsMembership } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useMemo } from "react";

import { useThreadShells } from "../state/entities";
import { useUiStateStore } from "../uiStateStore";
import { fixMateChoice, type FixMate } from "./fixRequest";
import { useZeropsCandidates } from "./useZeropsCandidates";

export interface FixMateOption extends FixMate {
  /** What the person calls it: "Ask Nova to fix it". */
  readonly name: string;
}

export function fixMatesOf(input: {
  /** The Mate the problem was found by: its project. */
  readonly projectId: string;
  /** The project (group) the problem is in; undefined outside one. */
  readonly groupId: string | undefined;
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  /** Whether a Mate is the person's own; undefined where nobody can say. */
  readonly isMine: (candidate: ZeropsCandidate) => boolean | undefined;
  /** When the person last opened a conversation of the Mate at `environmentId`. */
  readonly visitedAt: (environmentId: string) => string | undefined;
}): ReadonlyArray<FixMateOption> {
  const seen = new Set<string>();
  const options: FixMateOption[] = [];
  for (const candidate of input.candidates) {
    const { project } = candidate;
    // A project with no Mate container of its own is an environment, not a Mate.
    if (candidate.missingContainer === true || candidate.creationFailed !== undefined) continue;
    // Not connected: there is no conversation here to write the problem into.
    if (candidate.group !== "connected" || candidate.environmentId === undefined) continue;
    const tags = readZeropsMembership(project);
    const inProject =
      project.id === input.projectId ||
      (input.groupId !== undefined && tags.groupId === input.groupId);
    if (!inProject || seen.has(project.id)) continue;
    seen.add(project.id);
    const lastVisitedAt =
      candidate.environmentId === undefined ? undefined : input.visitedAt(candidate.environmentId);
    options.push({
      mateProjectId: project.id,
      mine: input.isMine(candidate) ?? true,
      ...(lastVisitedAt === undefined ? {} : { lastVisitedAt }),
      name: projectNameInApp(project),
    });
  }
  return fixMateChoice(options).map(({ lastVisitedAt: _lastVisitedAt, ...option }) => option);
}

/**
 * The Mate a run's problem goes to: the run's own, and only while it is the
 * person's. The problem was found in its conversation, in its services, and
 * only the person who signed it in runs it (D6) — another of the person's
 * Mates would be pointed at a service that is not its own, and a colleague's
 * Mate is the colleague's to ask. `options` are `fixMatesOf`'s.
 */
export function runFixMate(
  options: ReadonlyArray<FixMateOption>,
  runProjectId: string,
): FixMateOption | undefined {
  return options.find((option) => option.mateProjectId === runProjectId);
}

/**
 * The Mates a fix found by the Mate of project `projectId` can go to, in the
 * order they are offered; empty until the listing names one.
 */
export function useFixMates(
  mate: { readonly projectId: string; readonly groupId: string | undefined } | undefined,
): ReadonlyArray<FixMateOption> {
  const { listing } = useZeropsCandidates();
  const candidates = heldCandidates(listing).rows;
  const personFacts = useAtomValue(shownHqPersonFactsAtom);
  const shells = useThreadShells();
  const visits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const projectId = mate?.projectId;
  const groupId = mate?.groupId;
  return useMemo(() => {
    if (projectId === undefined) return [];
    const visitedAt = (environmentId: string) =>
      shells
        .filter((shell) => String(shell.environmentId) === environmentId)
        .map((shell) => visits[scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id))])
        .filter((at): at is string => at !== undefined)
        .toSorted()
        .at(-1);
    return fixMatesOf({
      projectId,
      groupId,
      candidates,
      isMine: (candidate) => personFacts[candidate.project.id]?.mine,
      visitedAt,
    });
  }, [candidates, groupId, personFacts, projectId, shells, visits]);
}
