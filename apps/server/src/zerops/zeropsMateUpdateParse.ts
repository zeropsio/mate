/**
 * Parses the one-line JSON `zcp mate status --json` / `zcp mate update
 * --json` print on stdout (spec-mate.md §2.9, §2.1a "Facts" MD-17). Both
 * share `DesiredRelease()` on the zcp side; this module only decodes what
 * they answer.
 *
 * Tolerant by design: an `error` field on a status answer is a normal,
 * degraded-but-successful result (the manifest was unreachable, the
 * installed version keeps serving — spec-mate.md §2.1c), never a decode
 * failure.
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export interface MateStatusResult {
  readonly installed: string;
  readonly latest: string;
  readonly contract: number;
  readonly updateAvailable: boolean;
  readonly checkedAt: string;
  readonly error?: string | undefined;
}

const RawMateStatusResult = Schema.Struct({
  installed: Schema.String,
  latest: Schema.String,
  contract: Schema.Int,
  updateAvailable: Schema.Boolean,
  checkedAt: Schema.String,
  error: Schema.optional(Schema.String),
});

const decodeMateStatusResult = Schema.decodeUnknownOption(RawMateStatusResult);

/** The result of a `mate status` run, or undefined when the text is not one. Never throws. */
export const parseMateStatusOutput = (text: string): MateStatusResult | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return undefined;
  }
  return Option.getOrUndefined(decodeMateStatusResult(parsed));
};

export const MateUpdateAction = Schema.Literals(["none", "installed", "updated"]);
export type MateUpdateAction = typeof MateUpdateAction.Type;

export interface MateUpdateResult {
  readonly action: MateUpdateAction;
  readonly from: string;
  readonly to: string;
  readonly restarted: boolean;
  readonly error?: string | undefined;
}

const RawMateUpdateResult = Schema.Struct({
  action: MateUpdateAction,
  from: Schema.String,
  to: Schema.String,
  restarted: Schema.Boolean,
  error: Schema.optional(Schema.String),
});

const decodeMateUpdateResult = Schema.decodeUnknownOption(RawMateUpdateResult);

/**
 * The result of a `mate update` run, or undefined when the text is not one.
 * Parsed regardless of the process's exit code — a failed update is a
 * successful RPC carrying its JSON (spec-mate.md §2.9 MU-2). Never throws.
 */
export const parseMateUpdateOutput = (text: string): MateUpdateResult | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return undefined;
  }
  return Option.getOrUndefined(decodeMateUpdateResult(parsed));
};
