/**
 * The overview while it is read: its own shape — the title row, the filters' row and the project
 * cards side by side — at the places the page draws them, painted once and replaced by the page
 * in one frame. It says no words but its title, which is the page's own and never taken back.
 * The reload's whole path stands in with it (the router, the chat's layout, the door, HQ's member
 * read), so a reload paints this once and then the cards in the same places.
 */
import { Loading } from "../../ui/loading";
import { Skeleton } from "../../ui/skeleton";
import { ZeropsHostedFrame } from "../landing/ZeropsHostedFrame";

/** As many cards as a first screen holds at the reference width. */
const STAND_IN_CARDS = 3;

/** The title row, as `ZeropsProjectsHeader` stands it: its height is its buttons'. */
function TitleRow() {
  return (
    <div
      className="-mt-1.5 flex min-h-7 items-center justify-between gap-3"
      data-overview-stand-in-title=""
    >
      <h1 className="text-xl font-medium text-foreground">Overview</h1>
    </div>
  );
}

/** The cards' rail, as `ProjectCards` lays it out: the same row and card boxes, their words grey. */
export function OverviewCardsStandIn({ count = STAND_IN_CARDS }: { readonly count?: number }) {
  return (
    <Loading label="Your projects">
      <div className="ov-rail">
        <div className="ov-row" data-overview-stand-in-cards="">
          {Array.from({ length: count }, (_, index) => (
            <div className="ov-card gap-3" key={index}>
              <div className="flex items-center gap-2.5 px-1">
                <Skeleton className="size-8 shrink-0" shape="pill" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-3/5" />
                </div>
              </div>
              <div className="flex flex-col gap-2.5 px-1 pt-2 pb-2">
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Loading>
  );
}

/** The page's body under its frame: what `ZeropsProjectsPage` draws until it paints. */
export function OverviewStandInBody() {
  return (
    <>
      <TitleRow />
      <div className="space-y-6 pb-12">
        <div className="ov-filters" aria-hidden="true">
          <Skeleton className="h-7.5 w-12" shape="pill" />
          <Skeleton className="h-7.5 w-32" shape="pill" />
          <Skeleton className="h-7.5 w-16" shape="pill" />
        </div>
        <div className="flex flex-col gap-4">
          <OverviewCardsStandIn />
        </div>
      </div>
    </>
  );
}

/** The whole page, its frame included: for a wait that stands before the page mounts. */
export function OverviewStandIn() {
  return (
    <ZeropsHostedFrame bar={false} width="full">
      <OverviewStandInBody />
    </ZeropsHostedFrame>
  );
}
