/** Tab-local, account-scoped personal context. Stores presentation and ids, never recipe YAML,
 * credentials or callable ports. Restoring context never replays a write. */
import { MATE_SHAPE_IDS, MATE_TINT_IDS } from "@t3tools/shared/brand";
import * as Schema from "effect/Schema";

import { accountStorageKey } from "./accountLifetime";
import { creationSubsteps, type NewProjectBirth } from "./newProjectBirth";

const KEY = "creations.v1";
const Runtime = Schema.Struct({
  hostname: Schema.String,
  role: Schema.Literals(["dev", "stage", "utility"]),
});
const Substep = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  state: Schema.Literals(["done", "active", "waiting", "failed", "unfinished"]),
  why: Schema.optionalKey(Schema.String),
});
const Saved = Schema.Struct({
  organizationId: Schema.String,
  birthId: Schema.String,
  name: Schema.String,
  botName: Schema.String,
  face: Schema.Struct({
    tint: Schema.Literals(MATE_TINT_IDS),
    shape: Schema.Literals(MATE_SHAPE_IDS),
  }),
  locationId: Schema.NullOr(Schema.String),
  agents: Schema.Array(Schema.Literals(["claude-code", "codex"])),
  adds: Schema.optionalKey(
    Schema.Struct({
      appId: Schema.String,
      registers: Schema.Boolean,
      managed: Schema.optionalKey(Schema.Array(Schema.String)),
      runtimes: Schema.optionalKey(Schema.Array(Runtime)),
    }),
  ),
  startedAt: Schema.Number,
  hq: Schema.Struct({ projectId: Schema.String, address: Schema.String }),
  appId: Schema.NullOr(Schema.String),
  intent: Schema.NullOr(Schema.String),
  step: Schema.Literals(["registry", "create", "created"]),
  failed: Schema.NullOr(Schema.Struct({ reason: Schema.String, uncertain: Schema.Boolean })),
  projectId: Schema.NullOr(Schema.String),
  retainedSubsteps: Schema.Array(Substep),
});

const decodeSaved = Schema.decodeUnknownSync(Schema.Array(Saved));

export function saveCreations(births: Readonly<Record<string, NewProjectBirth>>): void {
  const key = accountStorageKey(KEY);
  if (key === null) return;
  try {
    const saved = Object.values(births).map(
      ({ progress: _progress, retainedSubsteps: _retained, ...birth }) => ({
        ...birth,
        retainedSubsteps: creationSubsteps(births[birth.birthId]!),
      }),
    );
    window.sessionStorage.setItem(key, JSON.stringify(saved));
  } catch {
    /* Storage can be unavailable; the current creation still runs. */
  }
}

export function restoreCreations(): Readonly<Record<string, NewProjectBirth>> {
  const key = accountStorageKey(KEY);
  if (key === null) return {};
  try {
    const saved = decodeSaved(JSON.parse(window.sessionStorage.getItem(key) ?? "[]"));
    return Object.fromEntries(
      saved.map((birth) => {
        const failed =
          birth.failed ??
          (birth.projectId === null
            ? {
                reason:
                  "This tab closed before the request finished. Check the projects before starting again.",
                uncertain: true,
              }
            : null);
        return [
          birth.birthId,
          {
            ...birth,
            failed,
            progress: null,
            retainedSubsteps: birth.retainedSubsteps.map((step) =>
              step.state === "active"
                ? {
                    ...step,
                    state: "failed" as const,
                    why:
                      failed?.reason ??
                      "This tab closed before setup finished. Finish setup from the Mate's menu.",
                  }
                : step,
            ),
          },
        ];
      }),
    );
  } catch {
    return {};
  }
}
