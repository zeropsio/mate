/**
 * The overview's filter (the owner, 2026-10-12: "we are maybe missing some filters like 'waiting
 * on your' at the top"): every project, the ones where something waits on the viewer, or the
 * viewer's own — each a link, so the menu and a shared address can open the overview on one.
 */
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { fadeFillOver } from "~/lib/loadFills";
import { useCardRowFirstFilled } from "./cardRowFill";
import { OverviewFiltersStandIn } from "./OverviewStandIn";

import { Tab } from "../../ui/tab-strip";
import { Button } from "../../ui/button";
import { EmptyState } from "../../ui/empty";
import { MateFace } from "../primitives";
import { overviewFilterTabs, type OverviewShow } from "./projectsView.logic";

/** How long the filters keep their seats for the cards' first fill before they stand alone. */
const FILTERS_WAIT_FOR_CARDS_MS = 1_500;

export function OverviewFilters({
  show,
  waiting,
  mine,
  ownsMates,
  onShow,
  withCards,
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
  /**
   * Cards stand under the filters and the page shows them now: on a load the filters keep their
   * seats until the cards' first fill (`cardRowFill`), so the page fills once. They came 180 to
   * 400 ms ahead of the cards, a moment of their own.
   */
  readonly withCards?: boolean | undefined;
}) {
  const filled = useCardRowFirstFilled();
  const waits = withCards === true && !filled;
  // No card answering holds the page's own words for long.
  const [waitedOut, setWaitedOut] = useState(false);
  useEffect(() => {
    if (!waits) return;
    const timer = setTimeout(() => setWaitedOut(true), FILTERS_WAIT_FOR_CARDS_MS);
    return () => clearTimeout(timer);
  }, [waits]);
  const held = waits && !waitedOut;
  // Held at any time (the page mounts hidden, and holds only once it shows), they fade in.
  const [stoodIn, setStoodIn] = useState(held);
  if (held && !stoodIn) setStoodIn(true);
  const tabs = overviewFilterTabs({ waiting, mine, ownsMates, show });
  if (tabs.length === 0) return null;
  if (held) return <OverviewFiltersStandIn />;
  return (
    <nav
      aria-label="Show projects"
      className="ov-filters"
      data-zerops-surface="overview-filters"
      // Taking their seats' place, they fade in where they stand, as the cards do.
      ref={stoodIn ? fadeFillOver : undefined}
    >
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
