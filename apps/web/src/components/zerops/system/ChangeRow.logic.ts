/**
 * A change's state in words, the same on every page and panel that draws a `ChangeRow`: an open
 * change by what stops it ("Ready to merge", "Draft", "Needs a rebase", "Mate gone"); a merged one
 * by where it went — live in the release that took it, on stage, deploying to stage, waiting for
 * production, or merged where there is no production to wait for, or where production follows
 * `main` and nothing waits.
 *
 * Pure: no React.
 */
import {
  changeAsksForReview,
  changeState,
  pullRequestBlocked,
} from "@t3tools/client-runtime/zerops";

/** An open change's words and their tone, by what stops it (`changeState`). */
export function openChangeWords(pull: Parameters<typeof changeState>[0]): {
  readonly words: string;
  readonly tone: NonNullable<ReturnType<typeof changeState>>["tone"];
} {
  const state = changeState(pull);
  return { words: state?.word ?? "Open", tone: state?.tone ?? "off" };
}

/**
 * Whether an open change can be reviewed now: nothing stops it, its Mate asks for it and still
 * carries it. A ledger's row offers *Review* only then; any other says what stops it instead.
 */
export function changeReviewable(pull: Parameters<typeof changeState>[0]): boolean {
  return pull.mateGone !== true && pullRequestBlocked(pull) === null && changeAsksForReview(pull);
}

/** Where a merged change went, as its row says it. */
export type MergedChangeWhere =
  /** A change to the setup repository: its files go to no place and no release. */
  | { readonly kind: "setup" }
  /**
   * The release that took it; `live` where production runs it or a newer release over it; `at`,
   * when that release was made.
   */
  | {
      readonly kind: "released";
      readonly tag: string;
      readonly live: boolean;
      readonly at?: string | undefined;
    }
  | { readonly kind: "on-stage" }
  | { readonly kind: "deploying-to-stage" }
  /** Production runs a release, and none took it yet. */
  | { readonly kind: "waits-for-production" }
  /** Nowhere to wait: no production, or production runs no release yet (its own line says so). */
  | { readonly kind: "merged" }
  /**
   * Production is deployed outside Mate and follows `main` (`GroupFlowProduction`'s `outside`): on
   * `main` it waits for no release. Said as merged: nobody here saw it go live.
   */
  | { readonly kind: "live-with-main" };

/** "Live in v0.1.3", "On stage", "Merged · waits for production", "Merged". */
export function mergedChangeWords(where: MergedChangeWhere): string {
  switch (where.kind) {
    case "setup":
      return "Setup files, not part of a release";
    case "released":
      return where.live ? `Live in ${where.tag}` : `In ${where.tag}`;
    case "on-stage":
      return "On stage";
    case "deploying-to-stage":
      return "Deploying to stage…";
    case "waits-for-production":
      return "Merged · waits for production";
    case "merged":
    case "live-with-main":
      return "Merged";
  }
}

/**
 * Whether a change taken by release `tag` is live: what production runs holds it. A roll back is a
 * release of its own, the newest, that runs an older release's content: what is live is the release
 * it goes back to (and that one's, where it was a roll back too). The change is live where that
 * release is the one that took it or newer. Releases are newest first, as the flow lists them;
 * unknown standing is not live.
 */
export function releaseIsLive(
  tag: string,
  releases: ReadonlyArray<{
    readonly tag: string;
    readonly standing?: string | undefined;
    readonly rollbackOf?: string | null | undefined;
  }>,
): boolean {
  const took = releases.findIndex((release) => release.tag === tag);
  let runs = releases.findIndex((release) => release.standing === "live");
  // Each roll back hands its content on to the release it goes back to; a loop of them is no answer.
  for (let hops = 0; runs !== -1 && hops < releases.length; hops += 1) {
    const back = releases[runs]?.rollbackOf;
    if (back === undefined || back === null) break;
    runs = releases.findIndex((release) => release.tag === back);
  }
  return runs !== -1 && took !== -1 && runs <= took && releases[runs]?.rollbackOf == null;
}

/** A change's row line: whose, then its state — "Juno · Ready to merge"; its state alone unnamed. */
export function changeRowLine(mate: string | undefined, words: string): string {
  return mate === undefined ? words : `${mate} · ${words}`;
}
