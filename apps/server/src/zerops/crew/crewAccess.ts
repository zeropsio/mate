/**
 * crewAccess — what a write to the crew home reaches: the crewmates it
 * changes, and every crewmate when it changes what they share, the goal or
 * the crew's name; a home written for the first time is all new. The crew's
 * door judges the write on the logins of what it reaches.
 *
 * @module crewAccess
 */
import type { CrewDefinition } from "@t3tools/shared/crewHome";

/** What a write to the crew home changes: what every crewmate shares, and which crewmates. */
export interface CrewHomeChange {
  readonly shared: boolean;
  readonly handles: ReadonlyArray<string>;
}

/** The crewmates `after` changes from `before`, by their whole entry and job; `before` absent is all new. */
export function crewHomeChange(
  before: CrewDefinition | undefined,
  after: CrewDefinition,
): CrewHomeChange {
  if (before === undefined) return { shared: true, handles: [] };
  const shared =
    before.name !== after.name ||
    before.brief.title !== after.brief.title ||
    before.brief.text !== after.brief.text;
  const entry = (definition: CrewDefinition, handle: string) => {
    const member = definition.members.find((candidate) => candidate.handle === handle);
    return member === undefined ? undefined : JSON.stringify(member);
  };
  const handles = [
    ...new Set([...before.members, ...after.members].map((member) => member.handle)),
  ].filter((handle) => entry(before, handle) !== entry(after, handle));
  return { shared, handles };
}
