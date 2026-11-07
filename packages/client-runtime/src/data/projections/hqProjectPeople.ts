/**
 * Who each project HQ places is, for the reader, as HQ computed it: its
 * owner — HQ's user id, named and pictured from the client's own member list (`zeropsPeople`) —,
 * whether its Mate waits on the reader, and who is signed in to each agent's own login now and who
 * ever was. Nothing is computed here from roles; an owner the member list does not name is drawn
 * as nobody's. A project HQ removed is in none of it.
 * Whether Zerops refused its key — the case a hand-over answers — is HQ's word too (`keyRefused`).
 * What the reader may do with it is no HQ word: the client decides that from live Zerops data
 * (`@t3tools/shared/zeropsPermissions`).
 *
 * @module data/projections/hqProjectPeople
 */
import type { MateProjectKey } from "./mateAttention.ts";
import type { PlacementValue } from "../families/hqNavigation.ts";

import { placementsScope } from "../families/hqNavigation.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";
import { zeropsPeople } from "./zeropsPeople.ts";

/** A Mate's owner: HQ's user id, as the member list names them. */
export interface HqMateOwner {
  readonly userId: string;
  readonly name: string;
  /** The platform's picture of them; `null` where they have none. */
  readonly avatarUrl: string | null | undefined;
}

export interface HqProjectPeople {
  /** HQ names an owner of it (`ownerUserId`), whether or not the member list names them. */
  readonly owned: boolean | undefined;
  /** The Chief of this Mate's person and whether the reader is that person. */
  readonly chief?: { readonly projectId: string | null; readonly mine: boolean | undefined };
  readonly owner: HqMateOwner | null;
  /** HQ names the reader as its person (`mine`); `undefined` where HQ does not say. */
  readonly mine: boolean | undefined;
  /** Its Mate waits on the reader, as HQ says (`waitsOnViewer`). */
  readonly waitsOnViewer: boolean | undefined;
  /** Zerops refused its key and HQ admitted none since: it cannot connect until handed over. */
  readonly keyRefused?: true | undefined;
  /** Who is signed in to each login now, by login id: whose the composer is. */
  readonly signedInNow: PlacementValue["signedInNow"] | undefined;
  /**
   * Who last signed each login in, by login id, signed out since or not: whether anybody has.
   */
  readonly everSignedIn: PlacementValue["everSignedIn"] | undefined;
}

/** A placement's person facts as the reader may read them (`HqProjectPeople`). */
function peopleOf(
  read: ProjectionReads,
  orgId: string,
  placement: PlacementValue,
): HqProjectPeople {
  const { person, signedInNow, everSignedIn } = placement;
  return {
    ...(person?.chiefProjectId === undefined
      ? {}
      : {
          chief: { projectId: person.chiefProjectId, mine: person.mine },
        }),
    owned: person?.ownerUserId === undefined ? undefined : person.ownerUserId !== null,
    owner: ownerOf(read, orgId, person?.ownerUserId ?? agentSigner(signedInNow, everSignedIn)),
    mine: person?.mine,
    waitsOnViewer: person?.waitsOnViewer,
    keyRefused: placement.mate?.keyRefused,
    signedInNow,
    everSignedIn,
  };
}

/**
 * Whose a Mate is where HQ names no `OWNER` on its project: the person signed in to its coding agent
 * now, else the last one who was (the owner, 2026-11-06: the faces on the menu's rows come back).
 */
function agentSigner(
  signedInNow: PlacementValue["signedInNow"] | undefined,
  everSignedIn: PlacementValue["everSignedIn"] | undefined,
): string | undefined {
  for (const logins of [signedInNow, everSignedIn]) {
    const id = logins?.["claude-code"] ?? logins?.["codex"] ?? Object.values(logins ?? {})[0];
    if (id !== undefined && id.length > 0) return id;
  }
  return undefined;
}

function ownerOf(
  read: ProjectionReads,
  orgId: string,
  userId: string | null | undefined,
): HqMateOwner | null {
  if (userId == null) return null;
  const person = zeropsPeople(read, orgId).get(userId);
  return person === undefined ? null : { userId, name: person.name, avatarUrl: person.avatarUrl };
}

export const hqProjectPeople: Projection<string, Readonly<Record<string, HqProjectPeople>>> = {
  name: "hqProjectPeople",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) =>
    Object.fromEntries(
      read.members(placementsScope(orgId)).ids.flatMap((projectId) => {
        const placement = read.fact("placement", projectId);
        if (placement.kind !== "known") return [];
        return [[projectId, peopleOf(read, orgId, placement.value)]];
      }),
    ),
  equals: sameValue,
};

/** One project's person facts and named owner, with only that person's fact as a dependency. */
export const hqProjectPerson: Projection<MateProjectKey, HqProjectPeople | undefined> = {
  name: "hqProjectPerson",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, { orgId, projectId }) => {
    if (!read.members(placementsScope(orgId)).ids.includes(projectId)) return undefined;
    const placement = read.fact("placement", projectId);
    if (placement.kind !== "known") return undefined;
    return peopleOf(read, orgId, placement.value);
  },
  equals: sameValue,
};
