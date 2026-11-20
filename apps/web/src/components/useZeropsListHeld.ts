import { useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { hqNavigationAnswered, shownHqMenuNavigationAtom } from "@t3tools/client-runtime/data";
import { useHqMatesRead } from "../zerops/useHqMatesRead";
import { MENU_HOLDS_FOR_HQ_MS, useLoadFill } from "~/lib/loadFills";

/** How long the menu's rows wait for HQ to say what waits on the viewer before they stand without it. */
const MENU_WAITS_PATIENCE_MS = 800;

/** Whether the menu's list still holds its loading rows (`zeropsListHeld` in `Sidebar`). */
export function useZeropsListHeld({
  zeropsSignedIn,
  zeropsListLoading,
}: {
  zeropsSignedIn: boolean;
  zeropsListLoading: boolean;
}): boolean {
  // The menu's list and what waits on the viewer come in one frame as the menu first paints: the
  // list holds its loading rows until rows of its own are there and HQ's navigation, which says
  // what waits, has settled (HQ down, or no HQ, settles it too). A list painted first was pushed
  // down 74 px when the Waiting on you row came, half a second in. Where HQ is slower than the
  // list, the list stands after `MENU_WAITS_PATIENCE_MS` without it; once it stands, it never
  // waits again.
  const zeropsHq = useHqMatesRead();
  const zeropsHqReading = zeropsSignedIn && zeropsHq.organizationId !== null && !zeropsHq.settled;
  // HQ's directory names and groups the rows: whether it has answered (`hqNavigationAnswered`).
  const zeropsDirectoryAnswered = useAtomValue(shownHqMenuNavigationAtom, hqNavigationAnswered);
  const zeropsListReady = !zeropsHqReading && !zeropsListLoading;
  const [zeropsListStood, setZeropsListStood] = useState(zeropsListReady);
  useEffect(() => {
    if (zeropsListReady) setZeropsListStood(true);
  }, [zeropsListReady]);
  // Its patience for what waits on the viewer runs from the moment its rows could stand, as ever;
  // only where HQ's directory is still unread by then (the rows would stand ungrouped, and be
  // regrouped) does it hold on, until the directory is read or `MENU_HOLDS_FOR_HQ_MS` is spent.
  const [zeropsListWaited, setZeropsListWaited] = useState<"no" | "short" | "long">("no");
  useEffect(() => {
    if (zeropsListStood || zeropsListLoading || !zeropsHqReading) return;
    const short = window.setTimeout(() => {
      setZeropsListWaited((waited) => (waited === "no" ? "short" : waited));
    }, MENU_WAITS_PATIENCE_MS);
    const long = window.setTimeout(() => {
      setZeropsListWaited("long");
    }, MENU_HOLDS_FOR_HQ_MS);
    return () => {
      window.clearTimeout(short);
      window.clearTimeout(long);
    };
  }, [zeropsHqReading, zeropsListLoading, zeropsListStood]);
  useEffect(() => {
    if (zeropsListWaited === "long" || (zeropsListWaited === "short" && zeropsDirectoryAnswered))
      setZeropsListStood(true);
  }, [zeropsDirectoryAnswered, zeropsListWaited]);
  // The menu's fill (`loadFills`): its rows, the top row's count and the foot's balance stand in
  // one frame, and in the page's own where the two are ready together.
  const zeropsListHeld = !useLoadFill("menu", zeropsListStood || zeropsListReady);
  return zeropsListHeld;
}
