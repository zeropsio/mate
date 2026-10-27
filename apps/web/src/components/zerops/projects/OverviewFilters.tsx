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
import { overviewFilterTabs, type OverviewShow } from "./projectsView.logic";

export function OverviewFilters({
  show,
  waiting,
  mine,
  ownsMates,
  onShow,
}: {
  readonly show: OverviewShow | undefined;
  /** How many projects something waits on the viewer in. */
  readonly waiting: number;
  /** How many projects hold a Mate of the viewer's. */
  readonly mine: number;
  /** The viewer's role may have Mates of its own (`roleOffers`' New project): Mine and Waiting on you can fill. */
  readonly ownsMates: boolean;
  /** In a conversation's panel the filter stays where it is: no address to go to. */
  readonly onShow?: ((show: OverviewShow | undefined) => void) | undefined;
}) {
  const tabs = overviewFilterTabs({ waiting, mine, ownsMates, show });
  if (tabs.length === 0) return null;
  return (
    <nav aria-label="Show projects" className="ov-filters" data-zerops-surface="overview-filters">
      {tabs.map((filter) => {
        const current = filter.show === show;
        const words = (
          <>
            {filter.label}
            {filter.count === undefined ? null : (
              <span className="ov-filter-count">{filter.count}</span>
            )}
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
