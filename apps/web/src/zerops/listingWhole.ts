/**
 * Whether an organization's listing is whole for the person looking: not only complete, but
 * lacking nothing still on its way — every project it does not show is one this person can never
 * see (the grant withholds it, NO_ACCESS, a denial confirmed) or that can never be read (its
 * identity or status unavailable, the list's own read malformed past reading). A member with
 * NO_ACCESS on one project never reads a complete listing, and its menu is remembered all the
 * same (loading-states pass, 2026-10-03); a project only a list has named, a member unresolved,
 * a read that failed and will run again, keep it partial.
 *
 * Which projects are never this person's is client-runtime's one rule (`projectsNeverSeen`), the
 * one the inventory admits by. Pure: the account's state feeds it (`state/zerops.ts`).
 */
import type {
  CollectionRead,
  Evidence,
  GrantMachine,
  ProjectRecord,
} from "@t3tools/client-runtime/zerops/data";

/** The evidence a grant holds, granted or lapsed; null before its first. */
export function evidenceOfGrant(machine: GrantMachine): Evidence | null {
  return machine.phase.phase === "granted"
    ? machine.phase.evidence
    : machine.phase.phase === "lapsed"
      ? machine.phase.last
      : null;
}

/** Whether a project's record can never be read into a row: its identity or status unavailable. */
const unreadable = (record: ProjectRecord): boolean =>
  record.identity.knowledge === "unavailable" || record.lifecycle.knowledge === "unavailable";

/** A list read that can never come out whole, however long it is waited for. */
const NEVER_WHOLE: ReadonlySet<string> = new Set([
  "malformed",
  "contradictory-total",
  "overflow",
  "budget",
]);

export function listingWholeForPerson(input: {
  /** The organization's project list as read (`reads.projectsOf`). */
  readonly read: Pick<CollectionRead<ProjectRecord>, "query" | "value">;
  /** The projects the listing shows a row of, after the grant's admission. */
  readonly shown: ReadonlySet<string>;
  readonly neverSeen: (projectId: string) => boolean;
}): boolean {
  const { query } = input.read;
  if (query.status !== "observed" || query.unresolvedMemberKeys.length > 0) return false;
  const coverage = query.coverage;
  if (
    coverage.kind !== "exhausted-traversal" &&
    !(coverage.kind === "partial" && NEVER_WHOLE.has(coverage.reason))
  ) {
    return false;
  }
  return input.read.value.every((member) => {
    switch (member.knowledge) {
      case "unresolved":
        return false;
      case "unavailable":
        // Forbidden, gone, or its access revoked: never this person's to see.
        return true;
      case "observed": {
        const projectId = member.record.ref.projectId;
        return (
          input.shown.has(projectId) || unreadable(member.record) || input.neverSeen(projectId)
        );
      }
    }
  });
}
