/**
 * One member's own grants, project by project (`GET /client-user/{id}/roles`): the projects a
 * member reaches beyond their organization role, in one read of theirs rather than every project's
 * row. Metadata, never a credential. No stream carries it, so it is read once while a screen names
 * the member's projects, and again only after our own write or the person's Try again.
 *
 * @module data/families/memberProjectRoles
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectGrantEntry } from "../../zerops/appAccess.ts";
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export type MemberProjectRolesValue = ReadonlyArray<ProjectGrantEntry>;

declare module "../model.ts" {
  interface FamilyValues {
    readonly memberProjectRoles: MemberProjectRolesValue;
  }
}

const Answer = Schema.Struct({
  projectRoleList: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});
const decodeAnswer = Schema.decodeUnknownOption(Answer);
const isGrant = Schema.is(Schema.Struct({ projectId: Schema.String, roleCode: Schema.String }));

export const memberProjectRolesFamily: FamilySpec<"memberProjectRoles"> = {
  family: "memberProjectRoles",
  authority: "zerops",
  scope: { source: "zerops", suffix: "member-roles", leaving: "removed", demand: "detail" },
  sampled: {
    path: ({ ownerId }) => `/client-user/${encodeURIComponent(ownerId)}/roles`,
    decode: (answer) =>
      Option.match(decodeAnswer(answer), {
        onNone: () => null,
        // A grant that names no project is left out alone; its neighbours are the list.
        onSome: ({ projectRoleList }) =>
          (projectRoleList ?? [])
            .filter(isGrant)
            .map(({ projectId, roleCode }) => ({ projectId, roleCode })),
      }),
    freshMs: null,
  },
};

/** The grants of the membership `clientUserId`, read under `orgId`'s link. */
export const memberRolesScope = (orgId: string, clientUserId: string): ScopeKey =>
  scopeOf(memberProjectRolesFamily, orgId, clientUserId);
