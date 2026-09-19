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
 * Whether a row still needs its role tag once the name has been shortened.
 *
 * Under a project heading, `Links - stage` reads as `stage`, and a `STAGE`
 * pill beside it is the same word a third time on one line. The tag earns its
 * place only where the name does not already carry the role — a project
 * somebody named `eu-west` that happens to be the production.
 *
 * Matched as a prefix, not an equality: the tag is the short spelling
 * (`prod`) of a word people write in full (`production`), and both say the
 * same thing to the person reading the row.
 */
export function environmentRoleTagIsRedundant(tag: string | null, shortenedName: string): boolean {
  if (tag === null) return false;
  return shortenedName.trim().toLocaleLowerCase().startsWith(tag.toLocaleLowerCase());
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
/**
 * Which roles a group can still be given.
 *
 * Only production is capped, and only at one: it is what the pipeline deploys
 * into, and a group holding two has no answer for which. A dev environment is
 * a Mate, and a project is worked on by as many Mates as the people on it
 * want; stage is likewise a thing you may want several of.
 *
 * Capping all three at one was what left a group with dev, stage and
 * production showing no way to add anything at all — the state that reads as
 * a missing feature rather than a full set.
 */
export function creatableRoles(group: ZeropsGroup): ReadonlyArray<ZeropsEnvironmentRole> {
  const hasProduction = group.environments.some((entry) => entry.role === "prod");
  return (["dev", "stage", "prod"] as const).filter((role) => role !== "prod" || !hasProduction);
}
