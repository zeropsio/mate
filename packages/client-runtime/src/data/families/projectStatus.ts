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

import type { ScopeKey } from "../model.ts";
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
const Frame = Schema.Struct({
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
  zerops: {
    entity: "project-status",
    membership: ({ orgId }) => [{ name: "clientId", operator: "eq", value: orgId }],
    updates: ({ orgId }) => [{ name: "clientId", operator: "eq", value: orgId }],
    decode: (raw) =>
      Option.match(decodeFrame(raw), {
        onNone: () => null,
        // Keyed by the project: every reader names it by the project's id.
        onSome: ({
          projectId,
          lifetimeScore,
          remainingCredit,
          projectInfoJsonObject,
          _version,
        }) => ({
          id: projectId,
          value: {
            projectId,
            hoursLeft: lifetimeScore ?? null,
            creditLimit: projectInfoJsonObject?.maxCreditLimit ?? null,
            remainingCredit: remainingCredit ?? null,
          },
          version: _version ?? null,
        }),
      }),
    refusedAlone: true,
  },
};

export const projectStatusScope = (orgId: string): ScopeKey => scopeOf(projectStatusFamily, orgId);
