/** The Git tab demands the account's remote-probe facts, revalidating after a verb. */
import { useAtomValue } from "@effect/atom-react";
import { workspaceQuery } from "../state/workspace";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useMemo } from "react";
import { appAtomRegistry } from "../rpc/atomRegistry";
export const ZEROPS_WORKSPACE_ROOT = "/var/www";
export const checkoutPathFor = (hostname: string): string => `${ZEROPS_WORKSPACE_ROOT}/${hostname}`;
export interface ZeropsGitRemoteAnswer {
  readonly reachable: boolean;
  readonly detail: string | undefined;
  /**
   * Asked again, and not answered yet. The last answer stands until the next one lands: a remote
   * that did not answer keeps saying so while it is checked again, never blinks calm in between.
   */
  readonly checking: boolean;
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
          if (AsyncResult.isSuccess(result))
            answers.set(repository, {
              reachable: result.value.reachable,
              detail: result.value.detail ?? undefined,
              checking: result.waiting,
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
