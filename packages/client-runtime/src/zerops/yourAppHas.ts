/**
 * What Your app runs, where a Mate's own stage is Your app: the newest change Add to your app put
 * there, said as the chat script says Your app's version ("has "Colours" · added 08:15"). Only
 * what the Mate's own adds built: a change is merged only once its build on the stage passed, so
 * the stage runs the newest one added — unless the deploy it runs was made after that merge (a
 * change being added now, a deploy nobody added), when nothing is said.
 *
 * Pure: no network, no clock, no platform globals.
 *
 * @module yourAppHas
 */

/** A merged change as HQ lists it. */
export interface YourAppChange {
  readonly kind: string;
  readonly mateProjectId: string;
  readonly repository: string;
  readonly title: string;
  readonly mergedAt: string | undefined;
  readonly landedOutside?: boolean | undefined;
}

export interface YourAppHas {
  readonly title: string;
  /** When it was added: its merge. */
  readonly at: string;
}

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
}): YourAppHas | undefined {
  const { deployedAt } = input;
  if (deployedAt == null || input.merged === undefined) return undefined;
  let newest: YourAppHas | undefined;
  for (const change of input.merged) {
    if (
      change.kind !== "code" ||
      change.landedOutside === true ||
      change.mateProjectId !== input.mateProjectId ||
      change.mergedAt === undefined ||
      (input.repository !== undefined && change.repository !== input.repository)
    )
      continue;
    if (newest === undefined || Date.parse(change.mergedAt) > Date.parse(newest.at))
      newest = { title: change.title, at: change.mergedAt };
  }
  if (newest === undefined || Date.parse(deployedAt) > Date.parse(newest.at)) return undefined;
  return newest;
}
