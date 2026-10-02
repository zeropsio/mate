/**
 * The account's registry, read from the organization's HQ (`GET /api/structure`, ADR 0002) and
 * shared from the screens that need it.
 *
 * It answers which applications exist and which projects are in them, as the reader sees them in
 * Zerops. An organization with no HQ has no registry: that is the empty one, not a failure — once
 * the member list said so. A read that fails is no answer: the registry last read from the same
 * HQ stands, or, before any, the read stays loading — never the empty registry settled, which
 * would drop every group from the tree, and never another HQ's registry, which a switch of
 * organization leaves behind. The rows fall back to the per-project `mate:g:` hints they already
 * render from, and the next read tries again.
 */
import {
  EMPTY_REGISTRY,
  registryFromHq,
  type ZeropsRegistry,
} from "@t3tools/client-runtime/zerops/hq";
import { useCallback, useEffect, useRef, useState } from "react";

import { accountHqApi, useAccountHq } from "./accountHq";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** How long a re-read for an owner waits after the last one. */
export const REGISTRY_OWNER_REREAD_MS = 30_000;
/** How many re-reads an owner the registry does not name is given before it stands unknown. */
export const REGISTRY_OWNER_REREADS = 3;

export interface ZeropsRegistryState {
  readonly registry: ZeropsRegistry;
  /** True until this HQ's registry has been read once. */
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

export function useZeropsRegistry(input: { readonly enabled: boolean }): ZeropsRegistryState {
  const { client, activeOrganization } = useZeropsSession();
  const clientId = input.enabled ? activeOrganization?.id : undefined;
  const { hq, status } = useAccountHq(clientId);
  const hqProjectId = hq.kind === "official" ? hq.projectId : undefined;
  const hqAddress = hq.kind === "official" ? hq.address : undefined;
  /** The HQ this registry is read from. */
  const source =
    clientId === undefined || hqProjectId === undefined
      ? undefined
      : `${clientId}:${hqProjectId}:${hqAddress}`;
  const [generation, setGeneration] = useState(0);
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly source: string;
    readonly registry: ZeropsRegistry;
  } | null>(null);
  const key = source === undefined ? "" : `${source}:${generation}`;

  useEffect(() => {
    if (
      key === "" ||
      source === undefined ||
      clientId === undefined ||
      hqProjectId === undefined ||
      hqAddress === undefined
    ) {
      return;
    }
    const controller = new AbortController();
    void accountHqApi(client, clientId, { projectId: hqProjectId, address: hqAddress })
      .structure(controller.signal)
      .then((structure) => {
        if (!controller.signal.aborted) {
          setAnswer({ key, source, registry: registryFromHq(structure) });
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setAnswer((last) => (last?.source === source ? { ...last, key } : last));
      });
    return () => {
      controller.abort();
    };
  }, [client, clientId, hqAddress, hqProjectId, key, source]);

  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);

  /** Each owner asked for, with the re-reads already made for it. */
  const [owners, setOwners] = useState<ReadonlyMap<string, number>>(() => new Map());
  const lastRereadAt = useRef<number | null>(null);
  const askForOwner = useCallback((owner: string) => {
    setOwners((current) => (current.has(owner) ? current : new Map(current).set(owner, 0)));
  }, []);

  // No HQ is an answer once the member list was read; before that it is not known yet.
  const loading =
    key === ""
      ? clientId !== undefined && hq.kind === "none" && status === "loading"
      : answer?.key !== key;
  const registry =
    key !== "" && answer !== null && answer.source === source ? answer.registry : EMPTY_REGISTRY;

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

/** The Gitea org a group is keyed by, or `undefined` while the registry names no such group. */
export function registryGroupSlug(
  registry: ZeropsRegistry,
  groupId: string | undefined,
): string | undefined {
  if (groupId === undefined) return undefined;
  return registry.groups.find((group) => group.groupId === groupId)?.slug;
}
