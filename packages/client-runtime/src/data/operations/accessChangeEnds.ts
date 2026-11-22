/**
 * A change HQ ran on the team moves what no Zerops stream carries: once one of the viewer's access
 * changes stops running — its `access:` key leaves, or its operation stops on a failure (waiting,
 * failed, or HQ holds no state of it) — the changed person's own grants (`memberProjectRoles`) are
 * read again, once, by the account, whichever screen is open. A key that arrives already stopped
 * counts: what it changed before stopping is unknown here. The membership itself needs nothing from
 * here: Zerops pushes every membership change (`clientUser`), whoever wrote it, and the member list
 * reads itself again on it (`organizationMembers`' `refreshOn`).
 *
 * @module data/operations/accessChangeEnds
 */
import type { HqAccessOperation } from "@t3tools/shared/hqAccessOperation";

import type { DetailDemand } from "../demand.ts";
import { hqAccessOperationFamily } from "../families/hqAccessOperation.ts";
import { scopeOf } from "../families/spec.ts";
import { readsOfState, type AccountStore } from "../store.ts";

/** One `access:` key as last seen: its person (none for a new address), and whether it stopped. */
interface Seen {
  readonly userId: string | null;
  readonly stopped: boolean;
}

const stopped = ({ operation }: HqAccessOperation) =>
  operation === null || operation.failure !== undefined;

/** Re-reads the grants of each person whose access change in `orgId` stops; the result stops. */
export function rereadOnAccessChangeEnds(options: {
  readonly store: Pick<AccountStore, "state" | "subscribe">;
  readonly orgId: string;
  /** Reads a detail again now while it is demanded, and on its next demand whatever its age. */
  readonly revalidate: (demand: DetailDemand) => void;
}): () => void {
  const { store, orgId } = options;
  const scope = scopeOf(hqAccessOperationFamily, orgId);
  let seen = new Map<string, Seen>();
  const look = () => {
    const read = readsOfState(store.state());
    const now = new Map<string, Seen>();
    for (const id of read.members(scope).ids) {
      const fact = read.fact("hqAccessOperation", id);
      if (fact.kind === "known")
        now.set(id, { userId: fact.value.change.userId ?? null, stopped: stopped(fact.value) });
    }
    const ended = new Set<string>();
    for (const [id, was] of seen)
      if (!was.stopped && !now.has(id) && was.userId !== null) ended.add(was.userId);
    for (const [id, is] of now)
      if (is.stopped && seen.get(id)?.stopped !== true && is.userId !== null) ended.add(is.userId);
    // Before reading again: the read dispatches, and this look runs again inside it.
    seen = now;
    if (ended.size === 0) return;
    const members = read.fact("organizationMembers", orgId);
    if (members.kind !== "known") return;
    for (const member of members.value)
      if (ended.has(member.user?.id ?? member.userId ?? ""))
        options.revalidate({ family: "memberProjectRoles", ownerId: member.id });
  };
  const stop = store.subscribe(look);
  look();
  return stop;
}
