/**
 * The source of one app version, as the organization's active versions state it: `GIT`, `CLI`,
 * or `NONE` for the no-code version a runtime starts with. A version not held yet is unknown — it
 * is on its way on the updates — until the active versions were refused, after which nothing
 * will bring it.
 *
 * @module data/projections/versionSource
 */
import { activeScope } from "../families/version.ts";
import { linkKeys } from "../model.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

export type VersionSource =
  | { readonly kind: "known"; readonly source: string | null }
  | { readonly kind: "unknown" }
  | { readonly kind: "refused" };

export const versionSource: Projection<
  { readonly orgId: string; readonly versionId: string },
  VersionSource
> = {
  name: "versionSource",
  keyOf: ({ orgId, versionId }) => `${orgId}/${versionId}`,
  derive: (read, { orgId, versionId }) => {
    const fact = read.fact("version", versionId);
    if (fact.kind === "known") return { kind: "known", source: fact.value.source };
    const refused = [read.stream(linkKeys.zerops(orgId)), read.stream(activeScope(orgId))].some(
      (stream) => stream.phase === "refused",
    );
    return refused ? { kind: "refused" } : { kind: "unknown" };
  },
  equals: sameValue,
};
