import { useEffect, useState } from "react";
import { useLoadFill } from "~/lib/loadFills";

/** Whether the menu's list still holds its loading rows (`zeropsListHeld` in `Sidebar`). */
export function useZeropsListHeld({ zeropsListLoading }: { zeropsListLoading: boolean }): boolean {
  // The menu's list and what waits on the viewer come in one frame as the menu first paints: the
  // list holds its loading rows until the menu's rows are settled (`menuRowsAtom`), which waits
  // for HQ's navigation and stands the rows without it once the data layer says HQ is slow past
  // its grace. A list painted first was pushed down 74 px when the Waiting on you row came, half
  // a second in. Once it stands, it never waits again.
  const [zeropsListStood, setZeropsListStood] = useState(!zeropsListLoading);
  useEffect(() => {
    if (!zeropsListLoading) setZeropsListStood(true);
  }, [zeropsListLoading]);
  // The menu's fill (`loadFills`): its rows, the top row's count and the foot's balance stand in
  // one frame, and in the page's own where the two are ready together.
  const zeropsListHeld = !useLoadFill("menu", zeropsListStood || !zeropsListLoading);
  return zeropsListHeld;
}
