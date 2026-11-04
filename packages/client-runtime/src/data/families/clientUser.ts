/**
 * An organization's memberships as Zerops pushes their changes (`client-user` updateStream, filtered
 * to the organization): each frame names one membership's role and status (`{id, roleCode, status,
 * userId, clientId}`, ZEROPS-070). Never listed and never read: the members' REST source stays the
 * organization's member list (`organizationMembers`), which a frame reads again, as a frame for the
 * signed-in person reads again their own membership and the projects they reach.
 *
 * @module data/families/clientUser
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ScopeKey } from "../model.ts";
import type { Row } from "../reducer.ts";
import type { ProjectionReads } from "../store.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export interface ClientUserValue {
  readonly clientId: string;
  readonly userId: string;
  readonly roleCode?: string;
  readonly status?: string;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly clientUser: ClientUserValue;
  }
}

const Frame = Schema.Struct({
  id: Schema.String,
  clientId: Schema.String,
  userId: Schema.String,
  roleCode: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  _version: Schema.optionalKey(Schema.Union([Schema.Finite, Schema.Null])),
});
const decodeFrame = Schema.decodeUnknownOption(Frame);

export const clientUserFamily: FamilySpec<"clientUser"> = {
  family: "clientUser",
  authority: "zerops",
  scope: { source: "zerops", suffix: "client-users", leaving: "removed", demand: "navigation" },
  zerops: {
    entity: "client-user",
    updates: ({ orgId }) => [{ name: "clientId", operator: "eq", value: orgId }],
    decode: (raw) =>
      Option.match(decodeFrame(raw), {
        onNone: () => null,
        onSome: ({ id, _version, ...value }) => ({ id, value, version: _version ?? null }),
      }),
    // A member Zerops will not stream memberships to keeps everything else: the members' list is
    // still read whole when a screen needs it.
    refusedAlone: true,
  },
};

export const clientUsersScope = (orgId: string): ScopeKey => scopeOf(clientUserFamily, orgId);

/**
 * Whether a pushed row is a membership change of the signed-in person in `orgId`: the person their
 * own `/user/info` names (`organizationUser`). Unknown until that is read.
 */
export function viewerMembershipChanged(orgId: string, row: Row, reads: ProjectionReads): boolean {
  if (row.family !== "clientUser" || row.value.clientId !== orgId) return false;
  const viewer = reads.fact("organizationUser", orgId);
  return viewer.kind === "known" && viewer.value.id === row.value.userId;
}
