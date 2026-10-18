/**
 * A project page's Changes card, grouped by what each change waits on: the open ones that ask
 * the person's review, lifted; merged work no release has taken yet; and released work under the
 * release that took it — open down to the one production runs, each older one folded to a line.
 */
import { changeAsksForReview, type FlowPullRequest } from "@t3tools/client-runtime/zerops";

import { cardChanges, type CardChange, type CardStage } from "./projectCard.logic";

export interface ReleaseGroup {
  readonly tag: string;
  readonly taggedAt: string;
  /** Production runs it. */
  readonly live: boolean;
  /** Drawn with its changes; folded to one line otherwise. */
  readonly open: boolean;
  /** The merged changes it took, newest first, as far as they are held. */
  readonly changes: ReadonlyArray<CardChange>;
  /** How many changes it took, where every one is held; `undefined` where some may not be. */
  readonly count: number | undefined;
}

export interface ProjectChangeGroups {
  /** Open, and asking for the person's review. */
  readonly waiting: ReadonlyArray<CardChange>;
  /** Open, and still being written: listed, asking nothing. */
  readonly drafts: ReadonlyArray<CardChange>;
  /**
   * Merged code no release took: "Ready to release" where a production stands to take it,
   * "Merged" where none does; on stage where the stage runs every one of it.
   */
  readonly ready: {
    readonly title: "Ready to release" | "Merged";
    readonly changes: ReadonlyArray<CardChange>;
    readonly onStage: boolean;
  };
  /** Newest first. */
  readonly releases: ReadonlyArray<ReleaseGroup>;
}

/** How many folded releases the card lists; production's page lists them all. */
export const FOLDED_RELEASES = 4;

export function projectChangeGroups(input: {
  readonly open: ReadonlyArray<FlowPullRequest>;
  readonly merged: ReadonlyArray<FlowPullRequest>;
  /** Newest first, as the flow lists them. */
  readonly releases: ReadonlyArray<{
    readonly tag: string;
    readonly taggedAt: string;
    readonly live: boolean;
  }>;
  readonly stage: CardStage | undefined;
  readonly production: boolean;
}): ProjectChangeGroups {
  const changes = cardChanges({
    open: input.open,
    merged: input.merged,
    releases: input.releases,
    stage: input.stage,
    production: input.production,
    limit: Number.POSITIVE_INFINITY,
  });
  const open = changes.filter((change) => change.open);
  const landed = changes.filter((change) => !change.open && change.at !== undefined);
  // The release that took a change: the oldest tagged at or after it merged (`cardChanges`).
  const tookOf = (change: CardChange) =>
    input.releases.findLast((release) => change.at !== undefined && release.taggedAt >= change.at);
  const ready = landed.filter(
    (change) => change.pull.kind !== "recipe" && tookOf(change) === undefined,
  );
  const oldestHeld = landed.at(-1)?.at;
  const liveAt = input.releases.findIndex((release) => release.live);
  const openTo = liveAt === -1 ? 0 : liveAt;
  const releases = input.releases
    .map((release, index): ReleaseGroup => {
      const took = landed.filter((change) => tookOf(change)?.tag === release.tag);
      const before = input.releases[index + 1];
      // Whole once the held changes reach back past the release before it.
      const whole =
        before !== undefined && oldestHeld !== undefined && oldestHeld <= before.taggedAt;
      return {
        tag: release.tag,
        taggedAt: release.taggedAt,
        live: release.live,
        open: index <= openTo,
        changes: took,
        count: whole ? took.length : undefined,
      };
    })
    .filter((group, index) => group.open || index <= openTo + FOLDED_RELEASES);
  return {
    waiting: open.filter((change) => changeAsksForReview(change.pull)),
    drafts: open.filter((change) => !changeAsksForReview(change.pull)),
    ready: {
      title: input.production ? "Ready to release" : "Merged",
      changes: ready,
      onStage: ready.length > 0 && ready.every((change) => change.words === "On stage"),
    },
    releases,
  };
}
