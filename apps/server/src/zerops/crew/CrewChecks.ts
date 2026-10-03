/**
 * CrewChecks - a crewmate's `setup` and `check`, run in its lane on the dev
 * service.
 *
 * `setup` (for example `npm ci`) runs when a lane is created and again when a
 * merge-in changes the lockfile; `check` runs on exactly the tree that will
 * land (the bors rule, CONCEPT §3.2). Both run as
 * `cd .crew/<lane> && <command>` with `CREW_PORT` and the crewmate's `env:`
 * exported, so two lanes' test servers do not both bind 3000 and a lane's
 * tests reach its own database when one is declared.
 *
 * The outcome is classified, not just passed through: a command stopped by
 * its timeout, or killed by a signal (the OOM killer), ends with that reason
 * and waits for a person to choose what continues.
 *
 * @module CrewChecks
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { shellQuote } from "../ZeropsWorkspaceAccess.ts";
import { CrewShell, laneDirectory, script, type CrewShellError } from "./CrewShell.ts";

/** Both run at most ten minutes unless the crewmate says otherwise (CONCEPT §3.1). */
export const DEFAULT_CHECK_TIMEOUT = Duration.minutes(10);

/** How much of a command's output an outcome carries. */
export const CHECK_TAIL_BYTES = 4_000;

/** How long the crew session outlives the command's own timeout. */
const SESSION_MARGIN = Duration.seconds(30);

const EXIT_MARKER = "crew-check-exit";
const LANE_MISSING_MARKER = "crew-check-lane-missing";

export interface CheckInput {
  readonly host: string;
  readonly lane: string;
  readonly kind: "setup" | "check";
  readonly command: string;
  readonly timeout?: Duration.Input | undefined;
  readonly crewPort?: number | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
}

export type CheckOutcome =
  | { readonly _tag: "passed"; readonly tail: string }
  | { readonly _tag: "failed"; readonly code: number; readonly tail: string }
  | { readonly _tag: "timed-out"; readonly tail: string }
  | { readonly _tag: "killed"; readonly signal: number; readonly tail: string }
  | { readonly _tag: "lane-missing" };

/**
 * The lane's environment as `export` lines: `CREW_PORT` first, then the
 * crewmate's `env:`. Names are quoted too, so a malformed one fails the
 * command visibly instead of being interpreted.
 */
export const laneEnvironment = (
  crewPort: number | undefined,
  env: Readonly<Record<string, string>> | undefined,
): string =>
  [
    ...(crewPort === undefined ? [] : [`export CREW_PORT=${crewPort}`]),
    ...Object.entries(env ?? {}).map(
      ([name, value]) => `export ${shellQuote(name)}=${shellQuote(value)}`,
    ),
  ]
    .map((line) => `${line}\n`)
    .join("");

/** 124 is `timeout`'s own; 128 + n is death by signal n. */
export const classifyExit = (code: number, tail: string): CheckOutcome =>
  code === 0
    ? { _tag: "passed", tail }
    : code === 124
      ? { _tag: "timed-out", tail }
      : code > 128
        ? { _tag: "killed", signal: code - 128, tail }
        : { _tag: "failed", code, tail };

export interface CrewChecksService {
  readonly run: (input: CheckInput) => Effect.Effect<CheckOutcome, CrewShellError>;
}

export class CrewChecks extends Context.Service<CrewChecks, CrewChecksService>()(
  "t3/zerops/crew/CrewChecks",
) {}

export const make = Effect.gen(function* () {
  const shell = yield* CrewShell;

  const run: CrewChecksService["run"] = (input) =>
    Effect.gen(function* () {
      const timeout = Duration.fromInputUnsafe(input.timeout ?? DEFAULT_CHECK_TIMEOUT);
      const seconds = Math.max(1, Math.ceil(Duration.toSeconds(timeout)));
      const body = script(
        `cd ${shellQuote(laneDirectory(input.lane))} 2>/dev/null || { printf '%s\\n' ${LANE_MISSING_MARKER}; exit 0; }\n` +
          laneEnvironment(input.crewPort, input.env) +
          `log=$(mktemp) || exit 1\n` +
          `timeout -k 5 ${seconds} sh -c ${shellQuote(input.command)} > "$log" 2>&1 < /dev/null\n` +
          `code=$?\n` +
          `printf '%s %s\\n' ${EXIT_MARKER} "$code"\n` +
          `tail -c ${CHECK_TAIL_BYTES} "$log"\n` +
          `rm -f "$log"\n`,
      );
      const result = yield* shell.run(input.host, body, {
        timeout: Duration.sum(timeout, SESSION_MARGIN),
      });
      if (result.stdout.startsWith(LANE_MISSING_MARKER)) {
        return { _tag: "lane-missing" } satisfies CheckOutcome;
      }
      const newline = result.stdout.indexOf("\n");
      const header = result.stdout.slice(0, newline === -1 ? undefined : newline);
      const tail = newline === -1 ? "" : result.stdout.slice(newline + 1);
      const code = header.startsWith(`${EXIT_MARKER} `)
        ? Number(header.slice(EXIT_MARKER.length + 1))
        : result.code;
      return classifyExit(Number.isFinite(code) ? code : result.code, tail);
    });

  return CrewChecks.of({ run });
});

export const layer = Layer.effect(CrewChecks, make);
