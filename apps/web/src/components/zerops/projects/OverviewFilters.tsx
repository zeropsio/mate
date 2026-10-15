/**
 * The overview's filter (the owner, 2026-10-12: "we are maybe missing some filters like 'waiting
 * on your' at the top"): every project, the ones where something waits on the viewer, or the
 * viewer's own — each a link, so the menu and a shared address can open the overview on one.
 */
import { Link } from "@tanstack/react-router";

import { Tab } from "../../ui/tab-strip";
import { Button } from "../../ui/button";
import { EmptyState } from "../../ui/empty";
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
            {/* Its count even at none: the filter says what it holds before it is pressed. */}
            {count === undefined ? null : <span className="ov-filter-count">{count}</span>}
          </>
        );
        if (onShow !== undefined) {
          return (
            <Tab
              active={current}
              aria-pressed={current}
              data-show={filter.show ?? "all"}
              key={filter.label}
              onClick={() => onShow(filter.show)}
              render={<button type="button" />}
              size="md"
              tabId={filter.show ?? "all"}
            >
              {words}
            </Tab>
          );
        }
        return (
          // Current only on its own address: by default an empty search is a part of every other,
          // and All read as current under each filter too.
          <Tab
            active={current}
            data-show={filter.show ?? "all"}
            key={filter.label}
            render={
              <Link
                activeOptions={{ exact: true }}
                search={filter.show === undefined ? {} : { show: filter.show }}
                to="/zerops"
              />
            }
            size="md"
            tabId={filter.show ?? "all"}
          >
            {words}
          </Tab>
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
  const back =
    onShow === undefined ? (
      <Button render={<Link search={{}} to="/zerops" />} size="sm" variant="link">
        Show all projects
      </Button>
    ) : (
      <Button onClick={() => onShow(undefined)} size="sm" variant="link">
        Show all projects
      </Button>
    );
  return (
    <div data-zerops-surface="overview-filter-empty" role="status">
      <EmptyState action={back} mark={<MateFace size={32} state="idle" tint="slate" />}>
        {show === "waiting"
          ? "Nothing waits on you. A question from one of your Mates, a change to review or a release to make shows up here."
          : "No Mate of yours yet. The projects where you have a Mate show up here."}
      </EmptyState>
    </div>
  );
}
