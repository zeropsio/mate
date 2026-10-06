/** Shared, once-per-input setup evidence. A slow read never holds navigation's baseline. */
import * as Effect from "effect/Effect";
import type { ZeropsError } from "./zerops/api.ts";

interface MateSetupInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly record: string;
  readonly serviceId: string | null;
  readonly importProcessId: string | null;
}

export const makeMateSetupMarkers = Effect.fnUntraced(function* (
  readMarker: (input: MateSetupInput) => Effect.Effect<boolean | null, ZeropsError>,
  changed: Effect.Effect<void>,
) {
  const scope = yield* Effect.scope;
  const entries = new Map<string, { input: MateSetupInput; value: boolean | null }>();
  const read = Effect.fnUntraced(function* (input: MateSetupInput) {
    const held = entries.get(input.projectId);
    if (
      held !== undefined &&
      held.input.orgId === input.orgId &&
      held.input.record === input.record &&
      held.input.serviceId === input.serviceId &&
      held.input.importProcessId === input.importProcessId
    )
      return held.value;
    const next = { input, value: held?.input.record === input.record ? held.value : null };
    entries.set(input.projectId, next);
    yield* readMarker(input).pipe(
      Effect.orElseSucceed(() => null),
      Effect.flatMap((value) =>
        Effect.gen(function* () {
          if (entries.get(input.projectId) !== next) return;
          if (value !== null) next.value = value;
          yield* changed;
        }),
      ),
      Effect.forkIn(scope),
    );
    return next.value;
  });
  return {
    read,
    retain: (projects: ReadonlySet<string>) => {
      for (const projectId of entries.keys())
        if (!projects.has(projectId)) entries.delete(projectId);
    },
  };
});
