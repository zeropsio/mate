import { HqEnvironmentDeclaration } from "@t3tools/shared/hqEnvironment";
import * as Schema from "effect/Schema";
/**
 * A project attached to its application as a stage or a production, as HQ's navigation records
 * its environment: the name HQ gave it and whether HQ holds a key that works — what an attach's
 * next step (its deploy key) reads, never a read of HQ's whole structure. Waiting until HQ's
 * navigation shows it; refused where the reader may not read its environments; unobserved once
 * HQ's link observes nothing more.
 *
 * @module data/projections/recordedEnvironment
 */
import { environmentKeyed } from "../../zerops/deployToken.ts";
import { linkKeys } from "../model.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { UNOBSERVED_PHASES } from "./operationEnd.ts";

const isEnvironmentDeclaration = Schema.is(HqEnvironmentDeclaration);

export type RecordedEnvironment =
  | { readonly kind: "waiting" }
  | {
      readonly kind: "recorded";
      readonly name: string;
      readonly keyed: boolean;
      readonly declaration: string;
    }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "unobserved" };

export const recordedEnvironment: Projection<
  { readonly orgId: string; readonly appId: string; readonly projectId: string },
  RecordedEnvironment
> = {
  name: "recordedEnvironment",
  keyOf: ({ orgId, appId, projectId }) => `${orgId}/${appId}/${projectId}`,
  equals: sameValue,
  derive: (read, { orgId, appId, projectId }) => {
    const app = read.fact("hqApp", appId);
    const environments = app.kind === "known" ? app.value.environments : undefined;
    if (environments !== undefined && "refused" in environments)
      return { kind: "refused", reason: environments.refused };
    const environment = environments?.find(
      (entry) => entry.target.kind === "zerops" && entry.target.projectId === projectId,
    );
    if (environment !== undefined) {
      if (!isEnvironmentDeclaration(environment.declaration))
        return { kind: "refused", reason: "HQ has not identified this environment declaration." };
      return {
        kind: "recorded",
        name: environment.name,
        keyed: environmentKeyed(environment),
        declaration: environment.declaration,
      };
    }
    return UNOBSERVED_PHASES.has(read.stream(linkKeys.hq(orgId)).phase)
      ? { kind: "unobserved" }
      : { kind: "waiting" };
  },
};
