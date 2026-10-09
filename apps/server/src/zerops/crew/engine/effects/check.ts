/**
 * `crew.check` (replay-safe, lane `check/<handle>`): a crewmate's check, or its setup, run in its
 * copy (`CrewChecks.run`, unchanged: its timeout, its untracked files set aside).
 *
 * A check writes nothing to adopt, and its verdict is worth only the tree it ran on: the outcome
 * names that tip. Asked for a tip (`tip`), the handler runs only on that tree; run again after a
 * crash, it checks the same tree again, and a copy that moved since is answered `moved` with no
 * check run. A failed check is its outcome, sent back to its crewmate; only a check that could not
 * run fails the effect.
 *
 * @module zerops/crew/engine/effects/check
 */
import * as Effect from "effect/Effect";

import type { EffectHandler } from "../../../../engine/outbox/EffectWorker.ts";
import { CrewChecks, type CheckOutcome } from "../../CrewChecks.ts";
import { CrewShell } from "../../CrewShell.ts";
import { CREW_EFFECT_KINDS, done, payloadOf, readLane, settled } from "./shared.ts";

export interface CheckPayload {
  readonly handle: string;
  readonly host: string;
  readonly kind: "setup" | "check";
  readonly command: string;
  readonly timeoutMs?: number;
  readonly crewPort?: number;
  readonly env?: Readonly<Record<string, string>>;
  /** The tree the check is for: a copy at any other tip is not checked. */
  readonly tip?: string;
}

export type CheckValue =
  /** The check ran on `tip`. */
  | { readonly _tag: "checked"; readonly tip: string; readonly outcome: CheckOutcome }
  /** The copy is no longer the tree the check was asked for. */
  | { readonly _tag: "moved"; readonly tip: string }
  | { readonly _tag: "lane-missing" };

export const makeCheck = Effect.gen(function* () {
  const checks = yield* CrewChecks;
  const shell = yield* CrewShell;

  return {
    kind: CREW_EFFECT_KINDS.check,
    run: (row) =>
      settled(
        Effect.gen(function* () {
          const payload = payloadOf<CheckPayload>(row);
          const copy = yield* readLane(shell, payload.host, payload.handle);
          if (!copy.present) return done({ _tag: "lane-missing" } satisfies CheckValue);
          if (payload.tip !== undefined && copy.tip !== payload.tip) {
            return done({ _tag: "moved", tip: copy.tip } satisfies CheckValue);
          }
          const outcome = yield* checks.run({
            host: payload.host,
            lane: payload.handle,
            kind: payload.kind,
            command: payload.command,
            timeout: payload.timeoutMs,
            crewPort: payload.crewPort,
            env: payload.env,
          });
          const value: CheckValue =
            outcome._tag === "lane-missing" ? outcome : { _tag: "checked", tip: copy.tip, outcome };
          return done(value);
        }),
      ),
  } satisfies EffectHandler;
});
