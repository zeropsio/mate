/**
 * An organization's members (`GET /client/{id}/user/list`): names, roles and pictures — metadata,
 * never a credential. No stream carries them, so the list is sampled while a screen needs it: its
 * official HQ's anchor, and a person a surface names whom HQ does not.
 *
 * @module data/families/organizationMembers
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ZeropsOrganizationMember } from "../../zerops/api.ts";
import type { ScopeKey } from "../model.ts";
import { STREAM_POLICY } from "../streamMachine.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export type OrganizationMembersValue = ReadonlyArray<ZeropsOrganizationMember>;

declare module "../model.ts" {
  interface FamilyValues {
    readonly organizationMembers: OrganizationMembersValue;
  }
}

/** The list is its own shape, `clientUserList` (measured 2026-09-18), not `items`. */
const Answer = Schema.Struct({
  clientUserList: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  items: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  list: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});
const decodeAnswer = Schema.decodeUnknownOption(Answer);
const Identified = Schema.Struct({ id: Schema.String });
const isMember = Schema.is(Identified);

export const organizationMembersFamily: FamilySpec<"organizationMembers"> = {
  family: "organizationMembers",
  authority: "zerops",
  scope: { source: "zerops", suffix: "members", leaving: "removed", demand: "detail" },
  sampled: {
    path: ({ ownerId }) => `/client/${encodeURIComponent(ownerId)}/user/list?limit=100`,
    decode: (answer) =>
      Option.match(decodeAnswer(answer), {
        onNone: () => null,
        // A row that names nobody is left out alone; its neighbours are the list.
        onSome: (list) =>
          (list.clientUserList ?? list.items ?? list.list ?? []).filter(
            isMember,
          ) as OrganizationMembersValue,
      }),
    freshMs: STREAM_POLICY.sampledIntervalMs,
  },
};

/** The members of `clientId` — by default the organization shown — read under `orgId`'s link. */
export const membersScope = (orgId: string, clientId = orgId): ScopeKey =>
  scopeOf(organizationMembersFamily, orgId, clientId);
