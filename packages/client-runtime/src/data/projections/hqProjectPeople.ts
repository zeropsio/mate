/**
 * Who each project HQ places is, for the reader, as HQ computed it: its
 * owner — named and pictured from HQ's person records —, whether its Mate waits on the reader, and
 * who is signed in to each agent's own login now and who ever was. Nothing is computed here from member lists or roles; an
 * owner HQ names no person record of is drawn as nobody's. A project HQ removed, or withheld, is in
 * none of it.
 *
 * @module data/projections/hqProjectPeople
 */
import type { PlacementValue } from "../families/hqNavigation.ts";

import { hqPeopleScope, placementsScope } from "../families/hqNavigation.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";

/** A Mate's owner as HQ names them. */
export interface HqMateOwner {
  readonly userId: string;
  readonly name: string;
  /** The platform's picture of them; `null` where they have none. */
  readonly avatarUrl: string | null | undefined;
}

export interface HqProjectPeople {
  /** HQ names an owner of it (`ownerUserId`), whether or not it sends their person record. */
  readonly owned: boolean | undefined;
  readonly owner: HqMateOwner | null;
  /** Its Mate waits on the reader, as HQ says (`waitsOnViewer`). */
  readonly waitsOnViewer: boolean | undefined;
  /** Who is signed in to each login now, by login id: whose the composer is. */
  readonly signedInNow: PlacementValue["signedInNow"];
  /** Who last signed each login in, by login id, signed out since or not: whether anybody has. */
  readonly everSignedIn: PlacementValue["everSignedIn"];
}

function ownerOf(
  read: ProjectionReads,
  orgId: string,
  userId: string | null | undefined,
): HqMateOwner | null {
  if (userId == null || !read.members(hqPeopleScope(orgId)).ids.includes(userId)) return null;
  const person = read.fact("hqPerson", userId);
  return person.kind === "known"
    ? { userId, name: person.value.name ?? "Unknown", avatarUrl: person.value.avatarUrl }
    : null;
}

export const hqProjectPeople: Projection<string, Readonly<Record<string, HqProjectPeople>>> = {
  name: "hqProjectPeople",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) =>
    Object.fromEntries(
      read.members(placementsScope(orgId)).ids.flatMap((projectId) => {
        const placement = read.fact("placement", projectId);
        if (placement.kind !== "known") return [];
        const { person, signedInNow, everSignedIn } = placement.value;
        return [
          [
            projectId,
            {
              owned: person?.ownerUserId === undefined ? undefined : person.ownerUserId !== null,
              owner: ownerOf(read, orgId, person?.ownerUserId),
              waitsOnViewer: person?.waitsOnViewer,
              signedInNow,
              everSignedIn,
            },
          ],
        ];
      }),
    ),
  equals: sameValue,
};
