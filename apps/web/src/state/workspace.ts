import { createAtomCommandScheduler } from "@t3tools/client-runtime/state/runtime";
import {
  vcsCommandScheduler,
  vcsCommandConcurrency,
  vcsRefsCacheStateAtom,
} from "@t3tools/client-runtime/state/vcs";
import { mateVcs } from "@t3tools/client-runtime/data";
/** Projection atoms over the account's workspace reads; atoms express demand, never retain answers. */
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import type { AccountStore } from "@t3tools/client-runtime/data";
import { workspaceReading } from "@t3tools/client-runtime/data";
import type { makeWorkspaceReads } from "@t3tools/client-runtime/data";
import {
  WORKSPACE_READS,
  type WorkspaceRead,
  type WorkspaceTarget,
} from "@t3tools/client-runtime/data";

export const workspaceHostAtom = Atom.make<{
  readonly data: AccountStore["data"];
  readonly reads: ReturnType<typeof makeWorkspaceReads>;
  readonly vcs: ReturnType<typeof import("@t3tools/client-runtime/data").makeVcsReads>;
  readonly act: ReturnType<typeof import("@t3tools/client-runtime/data").makeWorkspaceActions>;
  readonly writeFile: ReturnType<typeof import("@t3tools/client-runtime/data").makeFileWrites>;
} | null>(null).pipe(Atom.keepAlive);
export function workspaceQuery<K extends WorkspaceRead>(kind: K) {
  const projection = workspaceReading(kind);
  const family = Atom.family((key: string) => {
    const target = JSON.parse(key) as WorkspaceTarget<K>;
    let manual = false;
    const holder = Atom.make((get) => {
      const host = get(workspaceHostAtom);
      if (host === null) return null;
      // Existing stacked Git actions signal invalidation, without restoring their retired refs cache.
      if (kind === "refs") get(vcsRefsCacheStateAtom({ environmentId: target.environmentId }));
      get.addFinalizer(host.reads.demand(kind, target, manual));
      manual = false;
      return host;
    });
    return Atom.readable(
      (get) => {
        const host = get(holder);
        return host === null
          ? AsyncResult.initial<
              import("@t3tools/client-runtime/data").WorkspaceValue<K>,
              import("@t3tools/client-runtime/data").StreamFault
            >(true)
          : get(host.data.project(projection, target)).result;
      },
      (refresh) => {
        manual = true;
        refresh(holder);
      },
    ).pipe(Atom.withLabel(`data:${WORKSPACE_READS[kind].family}:${key}`));
  });
  return (target: WorkspaceTarget<K>) => family(JSON.stringify(target));
}

const mcpCommands = createAtomCommandScheduler();

export function workspaceCommand<
  K extends import("@t3tools/client-runtime/data").WorkspaceMutation,
>(
  kind: K,
): import("@t3tools/client-runtime/state/runtime").AtomCommand<
  import("@t3tools/client-runtime/data").MutationTarget<K>,
  import("@t3tools/client-runtime/data").MutationValue<K>,
  import("@t3tools/client-runtime/data").StreamFault
> {
  return {
    label: `data:${kind}`,
    run: (registry, target) => {
      const execute = () =>
        registry.get(workspaceHostAtom)?.act(kind, target) ??
        Promise.resolve(
          AsyncResult.fail<
            import("@t3tools/client-runtime/data").StreamFault,
            import("@t3tools/client-runtime/data").MutationValue<K>
          >({ outcome: "definitive-refusal", message: "Sign in before using workspace actions." }),
        );
      if (kind.startsWith("mate-mcp-"))
        return mcpCommands.schedule(
          registry,
          { mode: "serial", key: (target) => target.environmentId },
          target,
          execute,
        );
      if (
        (kind.startsWith("mate-vcs-") || kind === "mate-prepare-pull-request-thread") &&
        "cwd" in target.input &&
        typeof target.input.cwd === "string"
      )
        return vcsCommandScheduler.schedule(
          registry,
          vcsCommandConcurrency,
          { environmentId: target.environmentId, input: { cwd: target.input.cwd } },
          execute,
        );
      return execute();
    },
  };
}

const vcsAtoms = Atom.family((key: string) => {
  const target = JSON.parse(key) as import("@t3tools/client-runtime/data").VcsKey;
  const demand = Atom.make((get) => {
    const host = get(workspaceHostAtom);
    if (host === null) return null;
    get.addFinalizer(host.vcs.demand(target));
    return host;
  });
  return Atom.make((get) => {
    const host = get(demand);
    return host === null
      ? AsyncResult.initial<
          import("@t3tools/contracts").VcsStatusResult,
          import("@t3tools/client-runtime/data").StreamFault
        >(true)
      : get(host.data.project(mateVcs, target));
  });
});
export const vcsStatus = (target: import("@t3tools/client-runtime/data").VcsKey) =>
  vcsAtoms(JSON.stringify(target));
