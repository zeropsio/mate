/**
 * What each container of a project uses now, as Zerops reports it (`POST
 * /current-stats/group-by-search`, grouped by container): observed only while a screen shows a
 * project's resources, by one registration for that project. Each frame lists the project's
 * containers again, so a container missing from it no longer runs; that says nothing of the
 * service it belonged to.
 *
 * @module data/families/usage
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export interface StatPair {
  readonly used: number;
  readonly limit: number;
}

/**
 * One container's current use. A dedicated core allocation reports as `cpu`, a shared one as
 * `vCpu` with `cpu` at `0/0`; a figure the platform leaves unsaid is `null`.
 */
export interface ContainerUsage {
  readonly serviceId: string;
  readonly containerId: string;
  readonly cpu: StatPair | null;
  readonly vCpu: StatPair | null;
  readonly ramGBytes: StatPair | null;
  readonly diskGBytes: StatPair | null;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly usage: ContainerUsage;
  }
}

const Pair = Schema.Struct({ used: Schema.Finite, limit: Schema.Finite });
const Row = Schema.Struct({
  serviceStackId: Schema.NonEmptyString,
  containerId: Schema.NonEmptyString,
  cpu: Schema.optionalKey(Pair),
  vCpu: Schema.optionalKey(Pair),
  ramGBytes: Schema.optionalKey(Pair),
  diskGBytes: Schema.optionalKey(Pair),
});
const decodeRow = Schema.decodeUnknownOption(Row);

export const usageFamily: FamilySpec<"usage"> = {
  family: "usage",
  authority: "zerops",
  scope: { source: "zerops", suffix: "usage", leaving: "removed", demand: "detail" },
  zeropsQuery: {
    path: "/current-stats/group-by-search",
    body: ({ orgId, ownerId }) => ({
      search: [
        { name: "clientId", operator: "eq", value: orgId },
        { name: "projectId", operator: "eq", value: ownerId },
      ],
      groupBy: "containerId",
    }),
    frames: "listing",
    decode: (raw) =>
      Option.match(decodeRow(raw), {
        onNone: () => null,
        onSome: (row) => ({
          id: row.containerId,
          version: null,
          value: {
            serviceId: row.serviceStackId,
            containerId: row.containerId,
            cpu: row.cpu ?? null,
            vCpu: row.vCpu ?? null,
            ramGBytes: row.ramGBytes ?? null,
            diskGBytes: row.diskGBytes ?? null,
          },
        }),
      }),
  },
};

/** One project's containers' current use, observed while demanded. */
export const usageScope = (orgId: string, projectId: string): ScopeKey =>
  scopeOf(usageFamily, orgId, projectId);
