/**
 * The places an organization may put a new project (`GET /client/{id}/settings`, its
 * `locationList` alone): sampled while the new project dialog asks where, read again on every
 * new demand.
 *
 * @module data/families/organizationLocations
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ZeropsLocation } from "../../zerops/api.ts";
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export type OrganizationLocationsValue = ReadonlyArray<ZeropsLocation>;

declare module "../model.ts" {
  interface FamilyValues {
    readonly organizationLocations: OrganizationLocationsValue;
  }
}

const Location = Schema.Struct({ id: Schema.String, name: Schema.String, pingUrl: Schema.String });
const Answer = Schema.Struct({ locationList: Schema.optionalKey(Schema.Array(Schema.Unknown)) });
const decodeAnswer = Schema.decodeUnknownOption(Answer);
const decodeLocation = Schema.decodeUnknownOption(Location);

export const organizationLocationsFamily: FamilySpec<"organizationLocations"> = {
  family: "organizationLocations",
  authority: "zerops",
  scope: { source: "zerops", suffix: "locations", leaving: "removed", demand: "detail" },
  sampled: {
    path: ({ ownerId }) => `/client/${encodeURIComponent(ownerId)}/settings`,
    decode: (answer) =>
      Option.match(decodeAnswer(answer), {
        onNone: () => null,
        // The settings carry more than the places; only their id, name and ping address leave.
        onSome: ({ locationList }) =>
          (locationList ?? []).flatMap((raw) =>
            Option.match(decodeLocation(raw), {
              onNone: () => [],
              onSome: ({ id, name, pingUrl }) => [{ id, name, pingUrl }],
            }),
          ),
      }),
    freshMs: 0,
  },
};

export const locationsScope = (orgId: string): ScopeKey =>
  scopeOf(organizationLocationsFamily, orgId, orgId);
