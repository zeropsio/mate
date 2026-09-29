/**
 * What a Mate's row in the left menu draws, read from what the row knows —
 * pure, so each rule has its table.
 */
import { pullRequestBlocked, type FlowPullRequest } from "@t3tools/client-runtime/zerops";

/** Whose Mate it is, as the mark before its name draws it. */
export interface OwnerMark {
  /** One letter, on the person's own hue where there is no picture. */
  readonly initial: string;
  /** The person's hue, 0–359: one person, one colour, on every row. */
  readonly hue: number;
  readonly picture: string | null;
  /** What the mark says to somebody who cannot see it, and on hover. */
  readonly label: string;
}

/**
 * The person as a 16 px mark: their picture, or their initial on a colour of
 * their own. The hue is read off the name, so it is the same on every row and
 * every reload without anything stored.
 */
export function ownerMark(owner: {
  readonly name: string;
  readonly initials: string;
  readonly avatarUrl: string | null;
}): OwnerMark {
  let hash = 5381;
  for (const character of owner.name) {
    hash = (hash * 33 + (character.codePointAt(0) ?? 0)) % 1_000_003;
  }
  return {
    initial: (owner.initials.trim().charAt(0) || owner.name.trim().charAt(0)).toLocaleUpperCase(),
    hue: hash % 360,
    picture: owner.avatarUrl !== null && owner.avatarUrl.length > 0 ? owner.avatarUrl : null,
    label: `${owner.name}'s Mate`,
  };
}

/**
 * The one colour a change row's pull-request mark may wear (S3): red where
 * its checks fail — broken — and amber where it has fallen behind `main` and
 * no longer merges — it didn't go through. Everything else is the mark's own
 * grey: checks running, Gitea still working the answer out, or nothing wrong.
 * The verdict itself lives in the review, not on the row; a change drawn from
 * memory says nothing until Gitea says it again.
 */
export function changeMarkTone(
  pull: Pick<FlowPullRequest, "number" | "mergeability" | "checks">,
  remembered: boolean,
): "failed" | "attention" | undefined {
  if (remembered) return undefined;
  if (pull.checks === "failing") return "failed";
  return pullRequestBlocked(pull)?.kind === "behind" ? "attention" : undefined;
}
