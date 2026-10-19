/**
 * The repositories a conversation's Diff reads, each with its git status — the record the Git
 * page reads: a Mate's service checkouts (`useMateRepositories`), else the conversation's own
 * folder. `reads` is `null` while which repositories there are is still read; `gitPage` says
 * whether the conversation has a Git page (a Zerops project's) for Diff to open.
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useMemo } from "react";

import { vcsStatus } from "../state/workspace";
import { useMateRepositories } from "../zerops/useMateRepositories";
import { useProjectTopology } from "../zerops/useProjectTopology";
import { checkoutPathFor } from "../zerops/useZeropsGitRemoteProbe";
import type { DiffRepository, DiffRepositoryRead } from "./DiffPanel.logic";

const READING = Atom.make<ReadonlyArray<DiffRepositoryRead> | null>(null);

export function useDiffRepositories(
  environmentId: EnvironmentId | null,
  cwd: string | null,
): { readonly reads: ReadonlyArray<DiffRepositoryRead> | null; readonly gitPage: boolean } {
  const mateRepositories = useMateRepositories(environmentId);
  const { view } = useProjectTopology(environmentId);
  const repositories: ReadonlyArray<DiffRepository> | null =
    mateRepositories === null
      ? null
      : mateRepositories.length > 0
        ? mateRepositories.map((hostname) => ({ name: hostname, cwd: checkoutPathFor(hostname) }))
        : cwd === null
          ? []
          : [{ name: cwd.split("/").findLast((part) => part.length > 0) ?? cwd, cwd }];
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
