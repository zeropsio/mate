/**
 * Who each project HQ places is, for the reader, as HQ computed it (HANDOFF §5 invariant 11): its
 * owner — named and pictured from HQ's person records —, whether its Mate waits on the reader, and
 * who signed each agent's own login in. Nothing is computed here from member lists or roles; an
 * owner HQ names no person record of is drawn as nobody's. A project HQ removed, or withheld, is in
 * none of it.
 *
 * @module data/projections/hqProjectPeople
 */
import type { HqNavigationProject } from "@t3tools/shared/hqStream";

import { hqPeopleScope, placementsScope } from "../families/hqNavigation.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";

/** A Mate's owner as HQ names them. */
export interface HqMateOwner {
  readonly userId: string;
  readonly name: string;
  /** The platform's picture of them; `null` where they have none. */
  readonly avatarUrl: string | null;
}

export interface HqProjectPeople {
  readonly owner: HqMateOwner | null;
  /** Its Mate waits on the reader: they signed its agent in (HQ's `waitsOnViewer`). */
  readonly waitsOnViewer: boolean;
  /** Who signed each agent's own login in, by Zerops user id. */
  readonly signers: HqNavigationProject["signers"];
}

function ownerOf(read: ProjectionReads, orgId: string, userId: string | null): HqMateOwner | null {
  if (userId === null || !read.members(hqPeopleScope(orgId)).ids.includes(userId)) return null;
  const person = read.fact("hqPerson", userId);
  return person.kind === "known"
    ? { userId, name: person.value.name, avatarUrl: person.value.avatarUrl }
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
        const { person, signers } = placement.value;
        return [
          [
            projectId,
            {
              owner: ownerOf(read, orgId, person.ownerUserId),
              waitsOnViewer: person.waitsOnViewer,
              signers,
            },
          ],
        ];
      }),
    ),
  equals: sameValue,
};
