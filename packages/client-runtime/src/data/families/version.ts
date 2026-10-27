/**
 * Zerops app versions, observed as what each service runs: the organization's `ACTIVE` membership
 * paired with the status-unfiltered updates (`registration-formats.jsonl`). Replacing a service's
 * active version arrives as one membership frame (`add:[new], delete:[old]`) and one update frame
 * (old `BACKUP`, new `ACTIVE`), in either order. Leaving the active scope is a
 * version no longer active, nothing about its existence.
 *
 * @module data/families/version
 */
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

/** An app version as the platform's row says it. The API never returns its name. */
export interface VersionValue {
  readonly id: string;
  readonly projectId: string;
  readonly serviceId: string;
  readonly status: string;
  /** `GIT`, `CLI`, or `NONE` on a runtime nothing was ever deployed to; `null` where unstated. */
  readonly source: string | null;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly version: VersionValue;
  }
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** The row's `_version`, the platform's ordering of its observations; `null` where it has none. */
const versionOf = (raw: Record<string, unknown>): number | null =>
  typeof raw._version === "number" ? raw._version : null;

function readVersion(raw: unknown): VersionValue | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const id = text(row.id);
  const projectId = text(row.projectId);
  const serviceId = text(row.serviceStackId);
  const status = text(row.status);
  if (id === null || projectId === null || serviceId === null || status === null) return null;
  return { id, projectId, serviceId, status, source: text(row.source) };
}

const organization = (orgId: string) => ({ name: "clientId", operator: "eq", value: orgId });

/** The listing of one version read by id (`GET /app-version/{id}`), held while a stop needs it. */
const BY_ID = "version";

export const versionFamily: FamilySpec<"version"> = {
  family: "version",
  authority: "zerops",
  scope: { source: "zerops", suffix: "active", leaving: "removed", demand: "navigation" },
  indexes: [
    /**
     * The version each service runs, by service: a row that says `ACTIVE` while the active scope
     * has not let it go. Whichever of the two frames of a replacement comes first, the old one
     * stops counting and the new one starts.
     */
    {
      name: "active",
      keyOf: (value, listed) =>
        value.status === "ACTIVE" && listed !== "removed" ? value.serviceId : null,
    },
  ],
  zerops: {
    entity: "app-version",
    membership: ({ orgId }) => [
      organization(orgId),
      { name: "status", operator: "eq", value: "ACTIVE" },
    ],
    updates: ({ orgId }) => [organization(orgId)],
    decode: (raw) => {
      const value = readVersion(raw);
      return value === null
        ? null
        : { id: value.id, value, version: versionOf(raw as Record<string, unknown>) };
    },
  },
  details: [
    {
      /**
       * One version the active versions do not hold — not listed yet, past their page limit, or
       * no longer active — read by id: its source, whatever its status. The platform answers one
       * it does not have with `400 appVersionNotFound` (`m0/vers-probe`), which refuses the read.
       */
      suffix: BY_ID,
      leaving: "removed",
      zerops: {
        path: ({ ownerId }) => `/app-version/${encodeURIComponent(ownerId ?? "")}`,
        items: (answer) =>
          typeof answer === "object" && answer !== null && "id" in answer ? [answer] : undefined,
      },
    },
  ],
};

export const activeScope = (orgId: string) => scopeOf(versionFamily, orgId);

/** One version read by id, observed while a stop needs it. */
export const versionScope = (orgId: string, versionId: string): ScopeKey =>
  `zerops:${orgId}:${BY_ID}:${versionId}`;
