/** Current signed-in membership evidence, shared by native capability consumers. */
import * as Schema from "effect/Schema";
import type { ZeropsUser } from "../../zerops/api/account.ts";
import { viewerMembershipChanged } from "./clientUser.ts";
import type { FamilySpec } from "./spec.ts";

// The dashboard uses clientUserList.roleCode/status/canCreateProjects and the exact membership id.
// frontend-legacy/libs/models/src/client-user/client-user.util.ts:55-120.
const valid = Schema.is(
  Schema.Struct({
    id: Schema.String,
    email: Schema.String,
    clientUserList: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        roleCode: Schema.String,
        status: Schema.String,
        canCreateProjects: Schema.Boolean,
      }),
    ),
  }),
);
declare module "../model.ts" {
  interface FamilyValues {
    readonly organizationUser: ZeropsUser;
  }
}
export const organizationUserFamily: FamilySpec<"organizationUser"> = {
  family: "organizationUser",
  authority: "zerops",
  scope: { source: "zerops", suffix: "organization-user", leaving: "removed", demand: "detail" },
  sampled: {
    path: () => "/user/info",
    decode: (raw) => (valid(raw) ? (raw as ZeropsUser) : null),
    // Read once, again on the person's own `client-user` frame (`refreshOn`) and after the Zerops
    // socket was lost, never on a cadence.
    freshMs: null,
    // The person's own org role is half of every Mate's visibility: Zerops pushes its change.
    refreshOn: ({ orgId }, row, previous) => viewerMembershipChanged(orgId, row, previous),
  },
};
