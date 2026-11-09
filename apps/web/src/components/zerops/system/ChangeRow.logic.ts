/**
 * A change's state in words, the same on every page and panel that draws a `ChangeRow`: an open
 * change by what stops it ("Ready to merge", "Draft", "Needs a rebase", "Mate gone"); a merged one
 * by where it went — live in the release that took it, on stage, deploying to stage, waiting for
 * production, or merged where there is no production to wait for.
 *
 * Pure: no React.
 */
import { changeState } from "@t3tools/client-runtime/zerops";

/** An open change's words and their tone, by what stops it (`changeState`). */
export function openChangeWords(pull: Parameters<typeof changeState>[0]): {
  readonly words: string;
  readonly tone: NonNullable<ReturnType<typeof changeState>>["tone"];
} {
  const state = changeState(pull);
  return { words: state?.word ?? "Open", tone: state?.tone ?? "off" };
}

/** Where a merged change went, as its row says it. */
export type MergedChangeWhere =
  /** A change to the setup repository: its files go to no place and no release. */
  | { readonly kind: "setup" }
  /** The release that took it; `live` where production runs it or a newer release over it. */
  | { readonly kind: "released"; readonly tag: string; readonly live: boolean }
  | { readonly kind: "on-stage" }
  | { readonly kind: "deploying-to-stage" }
  /** Production runs a release, and none took it yet. */
  | { readonly kind: "waits-for-production" }
  /** Nowhere to wait: no production, or production runs no release yet (its own line says so). */
  | { readonly kind: "merged" };

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
      return "Merged";
  }
}

/**
 * Whether the release that took a change runs on production now, or a newer release over it does:
 * the change is live. Releases are newest first, as the flow lists them; unknown standing is not live.
 */
export function releaseIsLive(
  tag: string,
  releases: ReadonlyArray<{ readonly tag: string; readonly standing?: string | undefined }>,
): boolean {
  const live = releases.findIndex((release) => release.standing === "live");
  const took = releases.findIndex((release) => release.tag === tag);
  return live !== -1 && took !== -1 && live <= took;
}

/** A change's row line: whose, then its state — "Juno · Ready to merge"; its state alone unnamed. */
export function changeRowLine(mate: string | undefined, words: string): string {
  return mate === undefined ? words : `${mate} · ${words}`;
}
