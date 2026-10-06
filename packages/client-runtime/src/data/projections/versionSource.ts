/**
 * The source of one app version, as the organization's active versions state it: `GIT`, `CLI`,
 * or `NONE` for the no-code version a runtime starts with. A version they do not hold is unknown
 * until their list first answers — it may bring it — and after that awaited: it is read by id
 * (`versionScope`), which states it whatever its status, or says the platform does not have it.
 * Every wait ends in an answer or a named failure, never a clock.
 *
 * @module data/projections/versionSource
 */
import { activeScope, versionScope } from "../families/version.ts";
import { linkKeys } from "../model.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

export type VersionSource =
  | { readonly kind: "known"; readonly source: string | null }
  /** Not held, and the active versions have not answered yet: their list may bring it. */
  | { readonly kind: "unknown" }
  /** Not held, though the active versions answered: it is to be read by id. */
  | { readonly kind: "awaited" }
  /** The read by id found none: the platform does not have it. */
  | { readonly kind: "not-listed" }
  /** The organization's active versions were refused: nothing will state it. */
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
    if (read.stream(versionScope(orgId, versionId)).phase === "refused")
      return { kind: "not-listed" };
    const refused = [read.stream(linkKeys.zerops(orgId)), read.stream(activeScope(orgId))].some(
      (stream) => stream.phase === "refused",
    );
    if (refused) return { kind: "refused" };
    return read.coverage(activeScope(orgId)) === "unknown"
      ? { kind: "unknown" }
      : { kind: "awaited" };
  },
  equals: sameValue,
};
