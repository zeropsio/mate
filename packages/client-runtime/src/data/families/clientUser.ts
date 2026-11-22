/**
 * An organization's memberships as Zerops lists them and pushes their changes (`client-user`
 * listStream and updateStream, filtered to the organization): each row names one membership's role
 * and status (`{id, roleCode, status, userId, clientId}`, ZEROPS-070), and a membership leaving the
 * organization is a list `delete` of its id. The members' REST source stays the organization's
 * member list (`organizationMembers`), which a change reads again. A frame naming the signed-in
 * person's own membership reads again their membership and the projects they reach; their
 * membership leaving (their removal) reads their membership alone, since Zerops refuses the
 * projects and the member list to someone no longer in the organization.
 *
 * @module data/families/clientUser
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { Row } from "../reducer.ts";
import type { ProjectionReads } from "../store.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

interface ClientUserValue {
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
    membership: ({ orgId }) => [{ name: "clientId", operator: "eq", value: orgId }],
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

/**
 * Whether a row is a membership change of the signed-in person in `orgId`: the person their own
 * `/user/info` names (`organizationUser`). A pushed row, or their membership leaving, as it was
 * held: the leaving reads their membership alone. Unknown until that is read.
 */
export function viewerMembershipChanged(orgId: string, row: Row, reads: ProjectionReads): boolean {
  if (row.family !== "clientUser" || row.value.clientId !== orgId) return false;
  const viewer = reads.fact("organizationUser", orgId);
  return viewer.kind === "known" && viewer.value.id === row.value.userId;
}

/**
 * The signed-in person's membership in `orgId` as the organization's membership listing holds it,
 * when it names another role or status than their own `/user/info` held: that read was answered
 * before a change the listing's registration answered after, and whose frame it never sent. The
 * row is read as that frame (`viewerMembershipChanged`); null while the two agree or either is
 * not read.
 */
export function viewerMembershipMissed(orgId: string, reads: ProjectionReads): Row | null {
  const viewer = reads.fact("organizationUser", orgId);
  if (viewer.kind !== "known") return null;
  for (const id of reads.members(scopeOf(clientUserFamily, orgId)).ids) {
    const listed = reads.fact("clientUser", id);
    if (listed.kind !== "known") continue;
    const { value } = listed;
    if (value.clientId !== orgId || value.userId !== viewer.value.id) continue;
    const held = viewer.value.clientUserList?.find(
      (membership) => (membership.clientId ?? membership.client?.id) === orgId,
    );
    const same =
      held !== undefined &&
      held.roleCode === value.roleCode &&
      (value.status === undefined || held.status === value.status);
    return same
      ? null
      : { family: "clientUser", id, value, revision: { kind: "zerops", version: null } };
  }
  return null;
}
