/**
 * A dev pool's workspaces as a person opens them: one per container zcp leases for one of the
 * Mate's chats, each by the preview zcp last read there (zcp `docs/spec-workflows.md` §8
 * DP-13/25/28/34, `docs/spec-mate.md` §2.8a.3). Never the pool's own slot routes: they balance over
 * every container, and a free or warm one answers nothing.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module poolWorkspaces
 */
import { isZeropsLeaseHeld, type ZeropsDevServer, type ZeropsLease } from "@t3tools/contracts";

/**
 * Whether a lease's dev server is a link: the newest envelope lists the lease held and confirmed
 * by the pool, and the server running at an address. Starting, crashed or parked open nothing.
 */
export const leaseServerOpens = (
  lease: Pick<ZeropsLease, "state" | "unverified">,
  server: Pick<ZeropsDevServer, "status" | "url">,
): boolean =>
  lease.state === "held" &&
  lease.unverified !== true &&
  server.status === "running" &&
  server.url !== undefined;

/** A chat and the lease it is bound to, if any: its title names the workspace. */
export interface LeaseChat {
  readonly title: string;
  readonly lease?:
    | { readonly alias: string; readonly acquiredAt?: string | undefined }
    | null
    | undefined;
}

/** One preview of a pool's workspace: its link, or in words why it has none. */
export interface PoolWorkspace {
  readonly key: string;
  /** The chat's title where a chat is bound to the lease, else `dev`; never a number. */
  readonly label: string;
  readonly url?: string;
  readonly port?: number;
  readonly why?: string;
}

/** Why a held workspace's preview has no link, by the server's status. */
const SERVER_WHY: Readonly<Record<string, string>> = {
  starting: "starting",
  crashed: "crashed",
  stopped: "stopped",
};

const chatTitle = (
  lease: Pick<ZeropsLease, "alias" | "acquiredAt">,
  chats: ReadonlyArray<LeaseChat>,
): string | undefined =>
  chats.find(
    (chat) =>
      chat.lease?.alias === lease.alias &&
      (chat.lease.acquiredAt === undefined ||
        lease.acquiredAt === undefined ||
        chat.lease.acquiredAt === lease.acquiredAt),
  )?.title;

/** Why the lease itself opens nothing, whatever its servers say. */
const leaseWhy = (lease: Pick<ZeropsLease, "state" | "unverified">): string | undefined =>
  lease.state === "parked"
    ? "paused"
    : lease.state === "unmounted"
      ? "not mounted"
      : lease.unverified === true
        ? "pool not answering"
        : undefined;

/**
 * The workspaces zcp holds on one pool, in alias order: each preview a link where it answers
 * (`leaseServerOpens`), else the reason in words. A lease zcp no longer holds is none.
 */
export function poolWorkspaces(input: {
  readonly pool: string;
  /** The newest envelope's `leases[]`; a lease it no longer lists is gone. */
  readonly leases: ReadonlyArray<ZeropsLease>;
  readonly chats: ReadonlyArray<LeaseChat>;
}): ReadonlyArray<PoolWorkspace> {
  return input.leases
    .filter((lease) => lease.pool === input.pool && isZeropsLeaseHeld(lease.state))
    .sort((left, right) => left.alias.localeCompare(right.alias, "en", { numeric: true }))
    .flatMap((lease): ReadonlyArray<PoolWorkspace> => {
      const title = chatTitle(lease, input.chats) ?? "dev";
      const previews = (lease.devServers ?? []).filter((server) => server.url !== undefined);
      const held = leaseWhy(lease);
      if (previews.length === 0)
        return [{ key: lease.alias, label: title, why: held ?? "no address yet" }];
      return previews.map((server): PoolWorkspace => {
        const key = `${lease.alias}:${server.name}`;
        const label = previews.length > 1 ? `${title} · ${server.name}` : title;
        const port = server.port === undefined ? {} : { port: server.port };
        if (server.url !== undefined && leaseServerOpens(lease, server))
          return { key, label, url: server.url, ...port };
        return { key, label, ...port, why: held ?? SERVER_WHY[server.status] ?? server.status };
      });
    });
}
