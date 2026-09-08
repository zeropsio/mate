/**
 * The siblings a new environment could be cloned from, with what each one
 * would give it.
 *
 * Demands every sibling's secret-stripped export recipe for one dialog and
 * keeps only importable results. Raw project export YAML stops at the shared
 * resource adapter and never reaches this hook.
 */

import type { ProjectCloneSourceRecipeResourceRequest } from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { useEffect, useState } from "react";

import type { ExportedRecipe } from "@t3tools/client-runtime/zerops";

import { useZeropsData } from "./zeropsDataContext";

export interface ZeropsCloneSource {
  readonly projectId: string;
  readonly name: string;
  readonly agentName: string | undefined;
  readonly recipe: ExportedRecipe;
}

export interface ZeropsCloneSibling {
  readonly projectId: string;
  readonly name: string;
  readonly agentName: string | undefined;
}

export function useZeropsCloneSources(
  organizationId: string | null,
  siblings: ReadonlyArray<ZeropsCloneSibling> | null,
): {
  readonly sources: ReadonlyArray<ZeropsCloneSource>;
  readonly loading: boolean;
} {
  const { projectRef, runtime } = useZeropsData();
  // The answer for one set of siblings; a different set is simply "not yet".
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly sources: ReadonlyArray<ZeropsCloneSource>;
  } | null>(null);
  const key =
    organizationId === null || siblings === null
      ? ""
      : [
          runtime.scope.account.apiOrigin,
          runtime.scope.account.accountId,
          runtime.scope.epoch,
          organizationId,
          ...siblings.map((sibling) => sibling.projectId),
        ].join("\u0000");

  // The caller memoizes `siblings` for the life of one dialog, so the array
  // is a fine dependency; `key` is what the answer is filed under.
  useEffect(() => {
    if (organizationId === null || siblings === null || siblings.length === 0) return;
    let cancelled = false;
    let scope: Scope.Closeable | null = null;
    void Effect.runPromise(
      Effect.gen(function* () {
        const acquiredScope = yield* Scope.make();
        scope = acquiredScope;
        if (cancelled) {
          yield* Scope.close(acquiredScope, Exit.void);
          return;
        }
        const sources = yield* Effect.forEach(
          siblings,
          (sibling) => {
            const request: ProjectCloneSourceRecipeResourceRequest = {
              kind: "project-clone-source-recipe",
              account: runtime.scope,
              project: projectRef(organizationId, sibling.projectId),
            };
            return runtime.resources.acquire(request).pipe(
              Scope.provide(acquiredScope),
              Effect.flatMap((lease) => lease.awaitSettled),
              Effect.map((snapshot): ZeropsCloneSource | undefined =>
                snapshot.status === "success" && snapshot.value !== undefined
                  ? { ...sibling, recipe: snapshot.value }
                  : undefined,
              ),
              Effect.orElseSucceed(() => undefined),
            );
          },
          { concurrency: "unbounded" },
        );
        if (!cancelled) {
          setAnswer({
            key,
            sources: sources.filter((source): source is ZeropsCloneSource => source !== undefined),
          });
        }
      }),
    );
    return () => {
      cancelled = true;
      if (scope !== null) void Effect.runPromise(Scope.close(scope, Exit.void));
    };
  }, [key, organizationId, siblings]);

  if (organizationId === null || siblings === null || siblings.length === 0) {
    return { sources: [], loading: false };
  }
  return answer !== null && answer.key === key
    ? { sources: answer.sources, loading: false }
    : { sources: [], loading: true };
}
