/**
 * The overview's filter (the owner, 2026-10-12: "we are maybe missing some filters like 'waiting
 * on your' at the top"): every project, the ones where something waits on the viewer, or the
 * viewer's own — each a link, so the menu and a shared address can open the overview on one.
 */
import { Link } from "@tanstack/react-router";

import { MateFace } from "../primitives";
import type { OverviewShow } from "./projectsView.logic";

const FILTERS: ReadonlyArray<{ readonly show: OverviewShow | undefined; readonly label: string }> =
  [
    { show: undefined, label: "All" },
    { show: "waiting", label: "Waiting on you" },
    { show: "mine", label: "Mine" },
  ];

export function OverviewFilters({
  show,
  waiting,
  mine,
  onShow,
}: {
  readonly show: OverviewShow | undefined;
  /** How many projects something waits on the viewer in. */
  readonly waiting: number;
  /** How many projects hold a Mate of the viewer's. */
  readonly mine: number;
  /** In a conversation's panel the filter stays where it is: no address to go to. */
  readonly onShow?: ((show: OverviewShow | undefined) => void) | undefined;
}) {
  return (
    <nav aria-label="Show projects" className="ov-filters" data-zerops-surface="overview-filters">
      {FILTERS.map((filter) => {
        const current = filter.show === show;
        const count =
          filter.show === "waiting" ? waiting : filter.show === "mine" ? mine : undefined;
        const words = (
          <>
            {filter.label}
            {count === undefined || count === 0 ? null : (
              <span className="ov-filter-count">{count}</span>
            )}
          </>
        );
        if (onShow !== undefined) {
          return (
            <button
              aria-pressed={current}
              className="ov-filter"
              data-current={current ? "" : undefined}
              data-show={filter.show ?? "all"}
              key={filter.label}
              onClick={() => onShow(filter.show)}
              type="button"
            >
              {words}
            </button>
          );
        }
        return (
          // Current only on its own address: by default an empty search is a part of every other,
          // and All read as current under each filter too.
          <Link
            activeOptions={{ exact: true }}
            className="ov-filter"
            data-current={current ? "" : undefined}
            data-show={filter.show ?? "all"}
            key={filter.label}
            search={filter.show === undefined ? {} : { show: filter.show }}
            to="/zerops"
          >
            {words}
          </Link>
        );
      })}
    </nav>
  );
}

/** A filter that leaves no project: what it would show, said calmly, and the way back to all. */
export function OverviewFilterEmpty({
  show,
  onShow,
}: {
  readonly show: OverviewShow;
  readonly onShow?: ((show: OverviewShow | undefined) => void) | undefined;
}) {
  return (
    <div className="ov-filter-empty" data-zerops-surface="overview-filter-empty" role="status">
      <MateFace size={32} state="idle" tint="slate" />
      <p className="ov-filter-empty-title">
        {show === "waiting" ? "Nothing waits on you" : "No Mate of yours yet"}
      </p>
      <p className="ov-filter-empty-line">
        {show === "waiting"
          ? "A question from one of your Mates, a change to review or a release to make shows up here."
          : "The projects where you have a Mate show up here."}
      </p>
      {onShow === undefined ? (
        <Link className="ov-filter-empty-back" search={{}} to="/zerops">
          Show all projects
        </Link>
      ) : (
        <button className="ov-filter-empty-back" onClick={() => onShow(undefined)} type="button">
          Show all projects
        </button>
      )}
    </div>
  );
}
