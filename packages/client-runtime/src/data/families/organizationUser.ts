/** Current signed-in membership evidence, shared by native capability consumers. */
import * as Schema from "effect/Schema";
import type { ZeropsUser } from "../../zerops/api.ts";
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
    // Shared supervisor refreshes while the account is shown and on reconnect/resume.
    freshMs: 30_000,
  },
};
