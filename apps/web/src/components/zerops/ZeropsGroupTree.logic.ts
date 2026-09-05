/**
 * Presentation decisions for the group tree — the words, not the pixels.
 *
 * Deliberately holds no status table. What an environment's container is
 * doing is already classified by `candidates.ts` and phrased by the picker;
 * a second table here would be a third opinion about the same fact, which
 * design-system rule R5 exists to prevent. The tree takes status as an
 * injected slot and decides only what is genuinely its own: role wording and
 * what a group's header says about itself.
 */

import type { ZeropsEnvironmentRole, ZeropsGroup } from "@t3tools/client-runtime/zerops";

/**
 * How a role is written in a sentence — "Add production", "Acme Docs -
 * production". Sentence case, not the tag's own spelling: `prod` is an
 * identifier, "Production" is the word people use.
 */
export function environmentRoleLabel(role: ZeropsEnvironmentRole | undefined): string | null {
  switch (role) {
    case "dev":
      return "Dev";
    case "devstage":
      return "Dev / Stage";
    case "stage":
      return "Stage";
    case "prod":
      return "Production";
    case undefined:
      return null;
  }
}

/**
 * How a role reads as a tag — the pill trailing an environment's name. The
 * tag's own short spelling, because a pill is a tag, and `PROD` beside a
 * name is what a developer calls it; `MicroLabel` sets the case.
 */
export function environmentRoleTag(role: ZeropsEnvironmentRole | undefined): string | null {
  switch (role) {
    case "dev":
      return "dev";
    case "devstage":
      return "dev/stage";
    case "stage":
      return "stage";
    case "prod":
      return "prod";
    case undefined:
      return null;
  }
}

/**
 * Whether the group's name is a real name or the id standing in for one. A
 * group named by its id is one the user should be invited to name — the tree
 * marks it rather than pretending `7k2m9qx4vb1c` is a title.
 */
export function groupNameIsPlaceholder(group: ZeropsGroup): boolean {
  return group.nameSource === "id";
}

/**
 * Which roles a group could still be given, in the order the UI offers them.
 * A role already taken is not offered again; `devstage` is left out entirely
 * because it is a thing you mark an existing environment as, not a thing you
 * create.
 */
export function creatableRoles(group: ZeropsGroup): ReadonlyArray<ZeropsEnvironmentRole> {
  const taken = new Set(group.environments.map((entry) => entry.role));
  return (["dev", "stage", "prod"] as const).filter((role) => !taken.has(role));
}
