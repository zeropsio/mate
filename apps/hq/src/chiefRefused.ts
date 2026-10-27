/**
 * The Chief's refusals (`chief.ts`, `proposals.ts`) and how a write of theirs is decided over the
 * org: as `confirmingRefusal` decides one, except that every refusal of the person's reach is
 * confirmed over a fresh read — a Chief's project tagged a moment ago is in no view kept from
 * before it.
 *
 * @module chiefRefused
 */
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { WRITE_BUDGET, WriteConfirm } from "./roles.ts";

export class ChiefRefused extends Schema.TaggedError<ChiefRefused>()("ChiefRefused", {
  code: Schema.Literals([
    "forbidden",
    "conflict",
    "invalid",
    "method_not_allowed",
    "chief_credential_required",
  ]),
  reason: Schema.optionalKey(Schema.String),
}) {}

const isChiefRefused = Schema.is(ChiefRefused);

/** How each refusal answers. */
export const CHIEF_STATUS = {
  forbidden: 403,
  conflict: 409,
  invalid: 400,
  method_not_allowed: 405,
  chief_credential_required: 401,
} as const;

/**
 * `write` decided over the org's view at most 30 s old (`Roles.forWrite`), and where it is refused
 * as `forbidden`, once more over a fresh read, whose refusal stands. Both passes' waits on Zerops end
 * within `WRITE_BUDGET` of its start.
 */
export const confirmingChiefRefusal = <A, E, R>(
  write: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const until = (yield* Clock.currentTimeMillis) + Duration.toMillis(WRITE_BUDGET);
    return yield* write.pipe(
      Effect.provideService(WriteConfirm, { fresh: false, until }),
      Effect.catchIf(
        (error) => isChiefRefused(error) && error.code === "forbidden",
        () => write.pipe(Effect.provideService(WriteConfirm, { fresh: true, until })),
      ),
    );
  });
