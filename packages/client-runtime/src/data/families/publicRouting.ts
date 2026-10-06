/**
 * A project's public HTTP routing (`GET /project/{id}/public-http-routing`): the domains that
 * reach its services beside their own subdomains. No stream carries it, so it is sampled while a
 * stop's addresses are drawn; the rest of a stop's public face is its project's and its services'
 * own rows (`projections/publicAccess.ts`).
 *
 * @module data/families/publicRouting
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ScopeKey } from "../model.ts";
import { STREAM_POLICY } from "../streamMachine.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

const Routing = Schema.Struct({
  isSynced: Schema.Boolean,
  sslEnabled: Schema.Boolean,
  domains: Schema.Array(Schema.Struct({ domainName: Schema.String })),
  locations: Schema.Array(
    Schema.Struct({ path: Schema.String, port: Schema.Finite, serviceStackId: Schema.String }),
  ),
});
const Answer = Schema.Struct({ list: Schema.Array(Routing) });
const decodeAnswer = Schema.decodeUnknownOption(Answer);

export type PublicRoutingValue = ReadonlyArray<typeof Routing.Type>;

declare module "../model.ts" {
  interface FamilyValues {
    readonly publicRouting: PublicRoutingValue;
  }
}

export const publicRoutingFamily: FamilySpec<"publicRouting"> = {
  family: "publicRouting",
  authority: "zerops",
  scope: { source: "zerops", suffix: "routing", leaving: "removed", demand: "detail" },
  sampled: {
    path: ({ ownerId }) => `/project/${encodeURIComponent(ownerId)}/public-http-routing`,
    decode: (answer) =>
      Option.match(decodeAnswer(answer), {
        onNone: () => null,
        // Only what an address is made of leaves: never a certificate or a routing's own id.
        onSome: ({ list }) =>
          list.map(({ isSynced, sslEnabled, domains, locations }) => ({
            isSynced,
            sslEnabled,
            domains: domains.map(({ domainName }) => ({ domainName })),
            locations: locations.map(({ path, port, serviceStackId }) => ({
              path,
              port,
              serviceStackId,
            })),
          })),
      }),
    freshMs: STREAM_POLICY.sampledIntervalMs,
  },
};

export const routingScope = (orgId: string, projectId: string): ScopeKey =>
  scopeOf(publicRoutingFamily, orgId, projectId);
