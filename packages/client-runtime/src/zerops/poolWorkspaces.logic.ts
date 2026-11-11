/**
 * A dev pool's workspaces as the Zerops panel opens them: one per preview zcp read on each container
 * it leases for one of the Mate's chats (zcp `docs/spec-workflows.md` §8 DP-13/25/28/34,
 * `docs/spec-mate.md` §2.8a.3). Never the pool's own slot routes: they balance over every
 * container, and a free or warm one answers nothing. Whether a preview opens is the one rule every
 * surface reads (`poolWorkspaceLink`); a workspace goes by the chat it is for, else its branch (`leaseLabel`).
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module poolWorkspaces
 */
import { isZeropsLeaseHeld, type ZeropsDevServer, type ZeropsLease } from "@t3tools/contracts";

import { leaseLabel, poolWorkspaceLink, type MatePartLeaseChat } from "./mateParts.ts";

/** A chat bound to a lease, by its title: what the workspace is for. */
export type LeaseChat = MatePartLeaseChat;

/** Whether one of a lease's dev servers is a link, by the one rule (`poolWorkspaceLink`). */
export const leaseServerOpens = (
  lease: Pick<ZeropsLease, "state" | "unverified">,
  server: ZeropsDevServer,
): boolean => poolWorkspaceLink({ ...lease, devServers: [server] }).url !== undefined;

/** One preview of a pool's workspace: its link, or in words why it has none. */
export interface PoolWorkspace {
  readonly key: string;
  /** The chat's title where a chat is bound to the lease, else `dev`; never a number. */
  readonly label: string;
  readonly url?: string;
  readonly port?: number;
  readonly why?: string;
}

/**
 * The workspaces zcp holds on one pool, in alias order: each preview a link where it opens
 * (`poolWorkspaceLink`), else the reason in words. A lease zcp no longer holds is none.
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
      const title = leaseLabel(lease, input.chats);
      const previews = (lease.devServers ?? []).filter((server) => server.url !== undefined);
      if (previews.length === 0) {
        const { why } = poolWorkspaceLink(lease);
        return [{ key: lease.alias, label: title, why: why ?? "no address yet" }];
      }
      return previews.map((server): PoolWorkspace => {
        const key = `${lease.alias}:${server.name}`;
        const label = previews.length > 1 ? `${title} · ${server.name}` : title;
        const port = server.port === undefined ? {} : { port: server.port };
        const link = poolWorkspaceLink({ ...lease, devServers: [server] });
        return link.url === undefined
          ? { key, label, ...port, why: link.why }
          : { key, label, url: link.url, ...port };
      });
    });
}
