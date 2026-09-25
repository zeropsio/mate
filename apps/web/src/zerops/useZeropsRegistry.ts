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
 * failure. A read that fails is no answer: the registry last read from the same
 * Gitea project stands, or, before any, the read stays loading — never the
 * empty registry settled, which would drop every group from the tree, and
 * never another project's registry, which a switch of organization leaves
 * behind. The rows fall back to the per-project `mate:g:` hints they already
 * render from, and the next read tries again.
 */

import type { ZeropsRegistry } from "@t3tools/client-runtime/zerops";
import { useCallback, useEffect, useRef, useState } from "react";

import { useZeropsSession } from "./ZeropsSessionProvider";

const EMPTY: ZeropsRegistry = { groups: [], leaving: [], other: [] };

/** How long a re-read for an owner waits after the last one. */
export const REGISTRY_OWNER_REREAD_MS = 30_000;
/** How many re-reads an owner the registry does not name is given before it stands unknown. */
export const REGISTRY_OWNER_REREADS = 3;

export interface ZeropsRegistryState {
  readonly registry: ZeropsRegistry;
  /** True until this project's registry has been read once. */
  readonly loading: boolean;
  /** Re-reads it — after a write, so the tree is not left one version behind. */
  readonly refresh: () => void;
  /**
   * A link names this Gitea org and the registry does not: it was made since the last read, or
   * that read failed. Re-reads the registry — shared by every link that asks, at most once per
   * {@link REGISTRY_OWNER_REREAD_MS}, and {@link REGISTRY_OWNER_REREADS} times per owner.
   */
  readonly askForOwner: (owner: string) => void;
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
    /** The Gitea project this registry was read from. */
    readonly giteaProjectId: string;
    readonly registry: ZeropsRegistry;
  } | null>(null);
  const key = enabled && giteaProjectId !== undefined ? `${giteaProjectId}:${generation}` : "";

  useEffect(() => {
    if (key === "" || giteaProjectId === undefined) return;
    const controller = new AbortController();
    void client
      .readGroupRegistry(giteaProjectId, controller.signal)
      .then((registry) => {
        if (!controller.signal.aborted) setAnswer({ key, giteaProjectId, registry });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setAnswer((last) => (last?.giteaProjectId === giteaProjectId ? { ...last, key } : last));
      });
    return () => {
      controller.abort();
    };
  }, [client, giteaProjectId, key]);

  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);

  /** Each owner asked for, with the re-reads already made for it. */
  const [owners, setOwners] = useState<ReadonlyMap<string, number>>(() => new Map());
  const lastRereadAt = useRef<number | null>(null);
  const askForOwner = useCallback((owner: string) => {
    setOwners((current) => (current.has(owner) ? current : new Map(current).set(owner, 0)));
  }, []);

  const loading = key !== "" && answer?.key !== key;
  const registry =
    key === ""
      ? EMPTY
      : answer !== null && answer.giteaProjectId === giteaProjectId
        ? answer.registry
        : EMPTY;

  useEffect(() => {
    if (key === "" || loading) return;
    const due = [...owners].filter(
      ([owner, rereads]) =>
        rereads < REGISTRY_OWNER_REREADS && !registry.groups.some((group) => group.slug === owner),
    );
    if (due.length === 0) return;
    const waitMs =
      lastRereadAt.current === null
        ? 0
        : Math.max(0, lastRereadAt.current + REGISTRY_OWNER_REREAD_MS - Date.now());
    const timer = setTimeout(() => {
      lastRereadAt.current = Date.now();
      setOwners((current) => {
        const next = new Map(current);
        for (const [owner, rereads] of due) next.set(owner, rereads + 1);
        return next;
      });
      refresh();
    }, waitMs);
    return () => {
      clearTimeout(timer);
    };
  }, [key, loading, owners, refresh, registry]);

  return { registry, loading, refresh, askForOwner };
}

/** The Gitea org a group is registered under, or `undefined` while it is not. */
export function registryGroupSlug(
  registry: ZeropsRegistry,
  groupId: string | undefined,
): string | undefined {
  if (groupId === undefined) return undefined;
  return registry.groups.find((group) => group.groupId === groupId)?.slug;
}
