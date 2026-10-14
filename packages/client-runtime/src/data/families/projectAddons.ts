/**
 * The organization's project add-ons as billing offers them (`GET /billing/client/{id}/available-
 * addons`, its `projectAddons`): for each project, its own IPv4 — whether it is on, its price per
 * 30 days, and the end of the period it is paid for. Sampled while the addresses sheet shows a
 * place, read again on every new demand; a viewer billing refuses sees no price.
 *
 * @module data/families/projectAddons
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export interface ProjectIpv4Addon {
  readonly projectId: string;
  /** Whether the project's own IPv4 is on. */
  readonly enabled: boolean;
  /** Its price for 30 days, in the organization's currency. */
  readonly unitPrice?: number;
  /** When the period it is paid for ends: where it renews, or goes. */
  readonly validTill?: string;
}

export interface ProjectAddonsValue {
  readonly ipv4: ReadonlyArray<ProjectIpv4Addon>;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly projectAddons: ProjectAddonsValue;
  }
}

/** The add-on billing names a project's own IPv4 (read 2026-10-14). */
const IPV4_METRIC = "PROJECT_IPV4";

const Addon = Schema.Struct({
  projectId: Schema.String,
  metricId: Schema.String,
  userEnabled: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  unitPrice: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  validTill: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const Answer = Schema.Struct({ projectAddons: Schema.optionalKey(Schema.Array(Schema.Unknown)) });
const decodeAnswer = Schema.decodeUnknownOption(Answer);
const decodeAddon = Schema.decodeUnknownOption(Addon);

export const projectAddonsFamily: FamilySpec<"projectAddons"> = {
  family: "projectAddons",
  authority: "zerops",
  scope: { source: "zerops", suffix: "addons", leaving: "removed", demand: "detail" },
  sampled: {
    path: ({ ownerId }) => `/billing/client/${encodeURIComponent(ownerId)}/available-addons`,
    decode: (answer) =>
      Option.match(decodeAnswer(answer), {
        onNone: () => null,
        onSome: ({ projectAddons }) => ({
          ipv4: (projectAddons ?? []).flatMap((raw) =>
            Option.match(decodeAddon(raw), {
              onNone: () => [],
              onSome: (addon) =>
                addon.metricId !== IPV4_METRIC
                  ? []
                  : [
                      {
                        projectId: addon.projectId,
                        enabled: addon.userEnabled === true,
                        ...(addon.unitPrice == null ? {} : { unitPrice: addon.unitPrice }),
                        ...(addon.validTill == null ? {} : { validTill: addon.validTill }),
                      },
                    ],
            }),
          ),
        }),
      }),
    freshMs: 0,
  },
};

export const addonsScope = (orgId: string): ScopeKey => scopeOf(projectAddonsFamily, orgId, orgId);
