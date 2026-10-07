/** The Git tab demands the account's remote-probe facts, revalidating after a verb. */
import { useAtomValue } from "@effect/atom-react";
import { workspaceQuery } from "../state/workspace";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useEffect, useMemo } from "react";
import { appAtomRegistry } from "../rpc/atomRegistry";
export const ZEROPS_WORKSPACE_ROOT = "/var/www";
export const checkoutPathFor = (hostname: string): string => `${ZEROPS_WORKSPACE_ROOT}/${hostname}`;
export interface ZeropsGitRemoteAnswer {
  readonly reachable: boolean;
  readonly detail: string | undefined;
}
const probe = workspaceQuery("gitRemote");
export function useGitRemoteReads(input: {
  readonly environmentId: EnvironmentId | undefined;
  readonly repositories: ReadonlyArray<string>;
  readonly generation: number;
}): ReadonlyMap<string, ZeropsGitRemoteAnswer> {
  const atoms = useMemo(
    () =>
      input.environmentId === undefined
        ? []
        : input.repositories.map((repository) => ({
            repository,
            atom: probe({
              environmentId: input.environmentId!,
              input: { cwd: checkoutPathFor(repository) },
            }),
          })),
    [input.environmentId, input.repositories],
  );
  const view = useMemo(
    () =>
      Atom.make((get) => {
        const answers = new Map<string, ZeropsGitRemoteAnswer>();
        for (const { repository, atom } of atoms) {
          const result = get(atom);
          const value = AsyncResult.isSuccess(result) && !result.waiting ? result.value : undefined;
          if (value !== undefined)
            answers.set(repository, {
              reachable: value.reachable,
              detail: value.detail ?? undefined,
            });
        }
        return answers;
      }),
    [atoms],
  );
  useEffect(() => {
    if (input.generation > 0) for (const { atom } of atoms) appAtomRegistry.refresh(atom);
  }, [atoms, input.generation]);
  return useAtomValue(view);
}
