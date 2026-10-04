/**
 * What a key of a Mate's project reaches, by its grants — the one definition HQ (which reads the
 * key a Mate names) and the client's harden (which lowers it) share, so Finish setup and HQ never
 * disagree about a key and loop (ADR 0003's fallout):
 *
 * - `own` — its one grant is the Mate's project, at a Mate's role: the Mate's key;
 * - `wider` — that grant, and READ_ONLY on other projects, nothing more: a Mate's key an earlier
 *   client widened, whose extra grants Finish setup takes off;
 * - `none` — anything else: a deploy key, a person's token, a key that may write another project.
 *   No Mate's key to keep, reuse or lower.
 */

/** The roles a Mate's own key holds on its project: as the platform mints it, and lowered. */
export const MATE_KEY_SELF_ROLES: ReadonlySet<string> = new Set(["ADMIN", "BASIC_USER"]);

export type MateKeyReach = "own" | "wider" | "none";

export function mateKeyReach(
  grants: ReadonlyArray<{ readonly projectId: string; readonly roleCode: string }>,
  projectId: string,
): MateKeyReach {
  const self = grants.filter((grant) => grant.projectId === projectId);
  if (self.length !== 1 || !MATE_KEY_SELF_ROLES.has(self[0]!.roleCode)) return "none";
  if (grants.length === 1) return "own";
  return grants.every((grant) => grant.projectId === projectId || grant.roleCode === "READ_ONLY")
    ? "wider"
    : "none";
}
