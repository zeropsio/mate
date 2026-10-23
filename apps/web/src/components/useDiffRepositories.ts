/**
 * The repositories a conversation's Diff reads (`diffRepositories`), each with its git status —
 * the record the Git page reads. The Mate's checkouts are waited for however long their status
 * takes (`useMateCheckouts`): Diff says it reads git until then, never that there is no code.
 * `reads` is `null` while which repositories there are is still read; `gitPage` says whether the
 * conversation has a Git page (a Zerops project's) for Diff to open.
 */
import { useAtomValue } from "@effect/atom-react";
import { crewFeedRead } from "@t3tools/client-runtime/zerops/projections/crew";
import type { CheckoutLease } from "@t3tools/client-runtime/zerops";
import type { EnvironmentId, ThreadCrewOrigin } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useMemo } from "react";

import { vcsStatus } from "../state/workspace";
import { zeropsFeeds } from "../state/zerops";
import { useMateCheckouts } from "../zerops/useMateRepositories";
import { useProjectTopology } from "../zerops/useProjectTopology";
import { diffRepositories, type DiffRepository, type DiffRepositoryRead } from "./DiffPanel.logic";

const READING = Atom.make<ReadonlyArray<DiffRepositoryRead> | null>(null);
const NO_CREW = Atom.make(undefined);

export function useDiffRepositories(
  environmentId: EnvironmentId | null,
  cwd: string | null,
  crew: ThreadCrewOrigin | null,
  lease: CheckoutLease | null,
): { readonly reads: ReadonlyArray<DiffRepositoryRead> | null; readonly gitPage: boolean } {
  const checkouts = useMateCheckouts(environmentId, lease);
  const { view } = useProjectTopology(environmentId);
  const crewRead = useAtomValue(
    environmentId === null || crew === null
      ? NO_CREW
      : zeropsFeeds.crew({ environmentId, input: {} }),
  );
  const { status: crewStatus, snapshot } = crewFeedRead(crewRead);
  // A crew not read yet places nothing; with no crew to place it, it works in the Mate's tree.
  const crewmate =
    crew === null || crewStatus === "off"
      ? null
      : snapshot === null
        ? undefined
        : (snapshot.crewmates.find((member) => member.handle === crew.crewmate) ?? null);
  const repositories = diffRepositories({ checkouts, cwd, crewmate, lease });
  const key = environmentId === null || repositories === null ? null : JSON.stringify(repositories);
  const atom = useMemo(() => {
    if (environmentId === null || key === null) return READING;
    const list = JSON.parse(key) as ReadonlyArray<DiffRepository>;
    return Atom.make((get) =>
      list.map((repository): DiffRepositoryRead => {
        const status = get(vcsStatus({ environmentId, input: { cwd: repository.cwd } }));
        return {
          repository,
          status: Option.getOrElse(AsyncResult.value(status), () =>
            AsyncResult.isFailure(status) ? ("failed" as const) : ("reading" as const),
          ),
        };
      }),
    );
  }, [environmentId, key]);
  return { reads: useAtomValue(atom), gitPage: view !== undefined };
}
