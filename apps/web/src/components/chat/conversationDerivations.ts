/**
 * What the conversation's view derives from a conversation's activities, kept with the list it was
 * derived from (`keptWith`): each is keyed by that list's identity, by its conversation, and by
 * the identity of every other input. A return to a conversation whose data did not change reads
 * what it read before it was left, so its list keeps its entries and its rows.
 */
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import { keptWith } from "../../lib/keptWith";
import {
  deriveTurnPlans,
  deriveWorkLogEntries,
  type TimelineEntriesProjection,
} from "../../session-logic";
import { deriveZeropsThreadModel } from "../../state/zerops";

type Activities = ReadonlyArray<OrchestrationThreadActivity>;
type ThreadModelInput = Parameters<typeof deriveZeropsThreadModel>[0];

export const keptZeropsThreadModel = keptWith(
  (
    activities: Activities,
    _threadKey: string | null,
    lifecycle: ThreadModelInput["lifecycle"],
    runningTurnId: ThreadModelInput["runningTurnId"],
    builds: ThreadModelInput["builds"],
    restarts: ThreadModelInput["restarts"],
  ) => deriveZeropsThreadModel({ activities, lifecycle, runningTurnId, builds, restarts }),
);

export const keptWorkLogEntries = keptWith(
  (activities: Activities, _threadKey: string | null, exclude: ReadonlySet<string>) =>
    deriveWorkLogEntries(activities, { exclude }),
);

export const keptTurnPlans = keptWith((activities: Activities, _threadKey: string | null) =>
  deriveTurnPlans(activities),
);

const projections = new WeakMap<
  Activities,
  { readonly threadKey: string | null; readonly projection: TimelineEntriesProjection }
>();

/**
 * A conversation's entries, projected for a reader that did not project its last ones (the view
 * returning to it, or its kept list reading it out of sight). They are projected from the entries
 * kept with these activities: where every source still holds what those were projected from, they
 * are the same entries, and the list that shows them keeps its rows. Where anything changed, they
 * are projected as a conversation first opened is, and never from the older ones.
 */
export function projectKeptTimeline(
  activities: Activities,
  threadKey: string | null,
  project: (before: TimelineEntriesProjection | null) => TimelineEntriesProjection,
): TimelineEntriesProjection {
  const held = projections.get(activities);
  const shown = held !== undefined && held.threadKey === threadKey ? held.projection : null;
  let projection = project(shown);
  if (shown !== null && projection.entries !== shown.entries) projection = project(null);
  projections.set(activities, { threadKey, projection });
  return projection;
}

/** Keeps what a conversation's own reader projected, update by update, for its next reader. */
export function keepTimelineProjection(
  activities: Activities,
  threadKey: string | null,
  projection: TimelineEntriesProjection,
): void {
  projections.set(activities, { threadKey, projection });
}
