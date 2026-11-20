import { useAtomValue } from "@effect/atom-react";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { appTasksWaitingAtom } from "~/state/zerops";
import { ProjectReviewMarks, type ProjectReviewTags } from "./SidebarProjectReview";
import { tasksWaitingWords } from "./SidebarMateRow.logic";

/** Its project's changes and release, as the row's tags draw them (`ProjectReviewTags`). */
export type ProjectReviewData = Parameters<typeof ProjectReviewTags>[0];

/**
 * What waits in a project, for its rows' marks (the owner, 2026-10-12: "release after project name
 * and merge after mate name"): its review and release, and the Mates whose own rows mark their
 * changes — a solo row's Mate, an open group's Mates; a folded group's row marks them all.
 */
interface RowMarksValue {
  readonly review: ProjectReviewData | undefined;
  readonly mates: ReadonlySet<string>;
}

const NO_MATES: ReadonlySet<string> = new Set();

const RowMarks = createContext<RowMarksValue>({ review: undefined, mates: NO_MATES });

/**
 * A project's marks for the rows under it: one value while its review and its Mates stand, so the
 * marks after each name are drawn again for their own news and not with every draw of the menu.
 */
export function RowMarksScope({
  review,
  mates,
  children,
}: {
  readonly review: ProjectReviewData | undefined;
  /** The Mates whose own rows mark their changes, by project id. */
  readonly mates: ReadonlyArray<string>;
  readonly children: ReactNode;
}) {
  const ids = mates.join(" ");
  const value = useMemo(
    () => ({ review, mates: ids === "" ? NO_MATES : new Set(ids.split(" ")) }),
    [review, ids],
  );
  return <RowMarks.Provider value={value}>{children}</RowMarks.Provider>;
}

/**
 * After a project's name: the tasks waiting for its automated Mates, what waits for production,
 * and changes no Mate's row here marks.
 */
export function ProjectNameMarks() {
  const { review, mates } = useContext(RowMarks);
  if (review === undefined) return null;
  const items = review.items.filter(
    (item) => item.mateProjectId === undefined || !mates.has(item.mateProjectId),
  );
  return (
    <>
      <ProjectTasksWaiting appId={review.groupId} />
      <ProjectReviewMarks {...review} items={items} withRun />
    </>
  );
}

/** "3 tasks waiting" for the application's automated Mates, only while any wait. */
function ProjectTasksWaiting({ appId }: { readonly appId: string }) {
  const words = tasksWaitingWords(useAtomValue(appTasksWaitingAtom(appId)));
  return words === undefined ? null : (
    <span
      className="shrink-0 truncate text-xs text-muted-foreground"
      data-zerops-surface="sidebar-project-tasks-waiting"
    >
      {words}
    </span>
  );
}

/** After a Mate's name: its own changes waiting on a review. */
export function MateNameMarks({ mateProjectId }: { readonly mateProjectId: string }) {
  const { review, mates } = useContext(RowMarks);
  if (review === undefined || !mates.has(mateProjectId)) return null;
  const items = review.items.filter((item) => item.mateProjectId === mateProjectId);
  return <ProjectReviewMarks {...review} items={items} release={undefined} />;
}
