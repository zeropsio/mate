/**
 * What a release's review says about the release itself — and why it keeps saying it once pressed.
 *
 * The tag, what it replaces, what goes out and where each service deploys from are read from the
 * project as it is offered. A release lands by changing exactly those reads: production runs the
 * new tag, nothing waits for it, every service runs what it deploys. Read again after it lands,
 * the review would describe the release against itself — "replaces v0.1.0 · 0 changes", "stays
 * on", and a roll back to the tag that just went out (measured 2026-10-02). So the facts are taken
 * when it is pressed and carried through Releasing and Released; the live state — production runs
 * it, since when — is the outcome's, beside them.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module releaseFacts
 */

import type { ReleaseComparison } from "./release.ts";
import type { ReleaseOutcome, ReviewPress } from "./reviewVerdict.ts";

/** A release's own facts, as the review shows them. `Row` is the surface's change row. */
export interface ReleaseFacts<Row> {
  /** The version it tags. */
  readonly tag: string;
  /**
   * The release production ran as it was offered: what this one replaces, and where a roll back
   * goes. `undefined` for the first release.
   */
  readonly replaces: string | undefined;
  /** What goes out, one row per change. */
  readonly rows: ReadonlyArray<Row>;
  /** Where: per service, what it redeploys from, or what it stays on. */
  readonly where: ReadonlyArray<{ readonly service: string; readonly line: string }>;
  /** The production services that redeploy — every one, when the comparison moves none. */
  readonly services: ReadonlyArray<string>;
}

/** The facts as the project reads them now. */
export function releaseFacts<Row>(input: {
  readonly tag: string;
  /** The release production runs now. */
  readonly live: string | undefined;
  readonly rows: ReadonlyArray<Row>;
  /** Per service, `main` against production (`compareForRelease`). */
  readonly comparison: ReadonlyArray<ReleaseComparison>;
  /** Production's services, for a release that moves none of them. */
  readonly productionServices: ReadonlyArray<string>;
}): ReleaseFacts<Row> {
  const moving = input.comparison.filter((row) => row.changed).map((row) => row.service);
  return {
    tag: input.tag,
    replaces: input.live,
    rows: input.rows,
    where: input.comparison.map((row) => ({
      service: row.service,
      line: row.changed
        ? `redeploys from ${row.candidate ?? "main"}`
        : `stays on ${row.production ?? "what it runs"}`,
    })),
    services: moving.length === 0 ? input.productionServices : moving,
  };
}

/**
 * The facts the review holds, given what it held and what the project reads now; `undefined`
 * while it holds nothing and shows the project as read.
 *
 * Offered and unpressed, nothing is held: the offer follows the project. From the press — or from
 * the first look at a release already on its way — the facts of that tag are held, and they stay
 * through its landing or its failure. A release that landed before anything was held has nothing
 * true left to hold: what is read now is the state it made.
 */
export function holdReleaseFacts<F extends { readonly tag: string }>(input: {
  readonly held: F | undefined;
  readonly current: F;
  readonly press: ReviewPress;
  readonly outcome: ReleaseOutcome;
}): F | undefined {
  const { held, current, outcome } = input;
  const pressed = input.press.kind === "running" || input.press.kind === "done";
  if (!pressed && outcome.kind === "offered") return undefined;
  if (held !== undefined && held.tag === current.tag) return held;
  return outcome.kind === "released" || outcome.kind === "failed" ? undefined : current;
}
