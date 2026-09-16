/**
 * The account's registry, read on the projects screen and shared from there.
 *
 * One project read — the tags on the account's Gitea project — answering which
 * groups exist, what each one's Gitea org is called, and which projects belong
 * to them (`groupRegistry.ts`, D3). It lives here because this is the one
 * screen that can see the whole account, and because every verb that writes it
 * needs to have read it first.
 *
 * An account with no Gitea has no registry: that is the empty one, not a
 * failure. A read that fails is not reported either — the rows fall back to the
 * per-project `mate:g:` hints they already render from, and the next read tries
 * again.
 */

import type { ZeropsRegistry } from "@t3tools/client-runtime/zerops";
import { useCallback, useEffect, useState } from "react";

import { useZeropsSession } from "./ZeropsSessionProvider";

const EMPTY: ZeropsRegistry = { groups: [], leaving: [], other: [] };

export interface ZeropsRegistryState {
  readonly registry: ZeropsRegistry;
  /** True until the first answer, so a verb never writes against a blank. */
  readonly loading: boolean;
  /** Re-reads it — after a write, so the tree is not left one version behind. */
  readonly refresh: () => void;
}

export function useZeropsRegistry(input: {
  /** The account's Gitea project, where the registry lives. */
  readonly giteaProjectId: string | undefined;
  readonly enabled: boolean;
}): ZeropsRegistryState {
  const { client } = useZeropsSession();
  const { enabled, giteaProjectId } = input;
  const [generation, setGeneration] = useState(0);
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly registry: ZeropsRegistry;
  } | null>(null);
  const key = enabled && giteaProjectId !== undefined ? `${giteaProjectId}:${generation}` : "";

  useEffect(() => {
    if (key === "" || giteaProjectId === undefined) return;
    const controller = new AbortController();
    void client
      .readGroupRegistry(giteaProjectId, controller.signal)
      .then((registry) => {
        if (!controller.signal.aborted) setAnswer({ key, registry });
      })
      .catch(() => {
        if (!controller.signal.aborted) setAnswer({ key, registry: EMPTY });
      });
    return () => {
      controller.abort();
    };
  }, [client, giteaProjectId, key]);

  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);

  if (key === "") return { registry: EMPTY, loading: false, refresh };
  return answer?.key === key
    ? { registry: answer.registry, loading: false, refresh }
    : { registry: answer?.registry ?? EMPTY, loading: true, refresh };
}

/** The Gitea org a group is registered under, or `undefined` while it is not. */
export function registryGroupSlug(
  registry: ZeropsRegistry,
  groupId: string | undefined,
): string | undefined {
  if (groupId === undefined) return undefined;
  return registry.groups.find((group) => group.groupId === groupId)?.slug;
}
