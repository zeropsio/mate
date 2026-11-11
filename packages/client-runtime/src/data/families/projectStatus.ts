/**
 * How long each of the organization's projects can run on its credit, as Zerops keeps it live
 * (`project-status`, listed and pushed for the organization, as the Zerops GUI observes it):
 * `lifetimeScore`, the hours until Zerops stops the project for insufficient funds — the GUI warns
 * at 8 hours and at 2 — and the project's own credit limit, where it has one. Zerops states the
 * hours only where they matter: on an organization with credit to spare they are `null`
 * (measured 2026-11-11: 68 rows, every `lifetimeScore` null). A member Zerops shows no finances
 * to is refused this scope alone.
 *
 * @module data/families/projectStatus
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { PublicRead, ScopeKey } from "../model.ts";
import type { ProjectionReads } from "../store.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export interface ProjectStatusValue {
  readonly projectId: string;
  /** Hours until Zerops stops the project for insufficient funds; `null` where Zerops says none. */
  readonly hoursLeft: number | null;
  /** The project's own credit limit and what is left of it; `null` without a limit. */
  readonly creditLimit: number | null;
  readonly remainingCredit: number | null;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly projectStatus: ProjectStatusValue;
  }
}

const Amount = Schema.optionalKey(Schema.NullOr(Schema.Finite));
/** The index from a project to its status row. */
const STATUS_OF = "status-of-project";

const Frame = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  lifetimeScore: Amount,
  remainingCredit: Amount,
  projectInfoJsonObject: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ maxCreditLimit: Amount })),
  ),
  _version: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
});
const decodeFrame = Schema.decodeUnknownOption(Frame);

export const projectStatusFamily: FamilySpec<"projectStatus"> = {
  family: "projectStatus",
  authority: "zerops",
  scope: { source: "zerops", suffix: "project-status", leaving: "removed", demand: "navigation" },
  indexes: [
    {
      name: STATUS_OF,
      keyOf: (value, listed) => (listed === "removed" ? null : value.projectId),
    },
  ],
  zerops: {
    entity: "project-status",
    membership: ({ orgId }) => [{ name: "clientId", operator: "eq", value: orgId }],
    updates: ({ orgId }) => [{ name: "clientId", operator: "eq", value: orgId }],
    decode: (raw) =>
      Option.match(decodeFrame(raw), {
        onNone: () => null,
        // Held under the row's own id, as listed; `statusOfProject` finds a project's.
        onSome: ({
          id,
          projectId,
          lifetimeScore,
          remainingCredit,
          projectInfoJsonObject,
          _version,
        }) => ({
          id,
          value: {
            projectId,
            hoursLeft: lifetimeScore ?? null,
            creditLimit: projectInfoJsonObject?.maxCreditLimit ?? null,
            remainingCredit: remainingCredit ?? null,
          },
          version: _version ?? null,
        }),
      }),
    refusedAlone: "any-refusal",
  },
};

export const projectStatusScope = (orgId: string): ScopeKey => scopeOf(projectStatusFamily, orgId);

const UNKNOWN: PublicRead<ProjectStatusValue> = { kind: "unknown" };

/** One project's status, by its row: unknown until Zerops listed it. */
export function statusOfProject(
  read: ProjectionReads,
  projectId: string,
): PublicRead<ProjectStatusValue> {
  for (const id of read.index(STATUS_OF, projectId)) return read.fact("projectStatus", id);
  return UNKNOWN;
}
