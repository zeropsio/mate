/**
 * What Your app runs, where a Mate's own stage is Your app: the change Add to your app put there,
 * said as the chat script says Your app's version ("has "Colours" · added 08:15 · version
 * abc1234"). Only what the Mate's own adds built.
 *
 * When the Mate's envelope names a commit (zcp `docs/spec-mate.md` §1.7), the row names the
 * Mate's own change with that head or merge commit, along with the version. An unmatched commit
 * leaves the line blank. With no commit, including a Review build's candidate, the stage shows
 * the newest change added if the deploy it runs is at least as old as that merge.
 *
 * Pure: no network, no clock, no platform globals.
 *
 * @module yourAppHas
 */
import { sameCommit } from "./versionName.ts";

/** A merged change as HQ lists it. */
export interface YourAppChange {
  readonly kind: string;
  readonly mateProjectId: string;
  readonly repository: string;
  readonly title: string;
  readonly mergedAt: string | undefined;
  readonly landedOutside?: boolean | undefined;
  /** The commit its branch stood at. */
  readonly headSha?: string | undefined;
  /** The commit it landed as on its base. */
  readonly mergeCommitSha?: string | undefined;
}

/** The version a stage runs, as its Mate's last envelope read it (`ZeropsStageVersion`). */
export interface YourAppVersion {
  /** The whole commit a commit deploy built it from; undefined for every other version. */
  readonly commit: string | undefined;
  readonly at: string;
}

export interface YourAppHas {
  readonly title: string;
  /** When it was added: its merge. */
  readonly at: string;
  /** The first 7 characters of the commit matching this change, if one was read. */
  readonly version: string | undefined;
}

const SHORT_COMMIT = 7;

export function yourAppHas(input: {
  readonly mateProjectId: string;
  /**
   * The stage's part, by the repository its changes name; undefined where the Mate has only one
   * stage, whose every change is its.
   */
  readonly repository: string | undefined;
  /** The application's merged changes. */
  readonly merged: ReadonlyArray<YourAppChange> | undefined;
  /** When the deploy the stage runs was made; null where it runs none, undefined unread. */
  readonly deployedAt: string | null | undefined;
  /** The version the stage runs, from the Mate's last envelope; undefined where not read. */
  readonly version: YourAppVersion | undefined;
}): YourAppHas | undefined {
  if (input.merged === undefined) return undefined;
  const own = input.merged.filter(
    (change): change is YourAppChange & { readonly mergedAt: string } =>
      change.kind === "code" &&
      change.landedOutside !== true &&
      change.mateProjectId === input.mateProjectId &&
      change.mergedAt !== undefined &&
      (input.repository === undefined || change.repository === input.repository),
  );
  const commit = input.version?.commit;
  if (commit !== undefined) {
    const built = own.find(
      (change) => sameCommit(commit, change.headSha) || sameCommit(commit, change.mergeCommitSha),
    );
    return built === undefined
      ? undefined
      : { title: built.title, at: built.mergedAt, version: commit.slice(0, SHORT_COMMIT) };
  }
  const { deployedAt } = input;
  if (deployedAt == null) return undefined;
  let newest: (typeof own)[number] | undefined;
  for (const change of own)
    if (newest === undefined || Date.parse(change.mergedAt) > Date.parse(newest.mergedAt))
      newest = change;
  if (newest === undefined || Date.parse(deployedAt) > Date.parse(newest.mergedAt))
    return undefined;
  return { title: newest.title, at: newest.mergedAt, version: undefined };
}
