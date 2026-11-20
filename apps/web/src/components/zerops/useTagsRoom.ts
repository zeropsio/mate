import { type RefObject, useLayoutEffect } from "react";

/** The gap between a project's places' tag and the time after it. */
const TAG_TIME_GAP_PX = 6;

/**
 * The room a project's places' tag takes at the end of its row's first line (`menu-row-tags`): the
 * tag stands beside the row's own button, never inside it, just before the time (`data-menu-time`),
 * by the widths the two measure — before the first paint, and again whenever the tag comes, goes
 * or changes its words, or the time its width. The line under the name never moves for it (run 2:
 * a busy stage's chip at that line's start pushed the Mate's words aside, and back).
 */
export function useTagsRoom(
  row: RefObject<HTMLElement | null>,
  tags: RefObject<HTMLElement | null>,
  present: boolean,
): void {
  useLayoutEffect(() => {
    const rowElement = row.current;
    const tagsElement = tags.current;
    if (rowElement === null) return;
    if (!present || tagsElement === null) {
      rowElement.removeAttribute("data-tags");
      rowElement.style.removeProperty("--menu-tags-w");
      rowElement.style.removeProperty("--menu-time-w");
      return;
    }
    const box: HTMLElement = rowElement;
    const tag: HTMLElement = tagsElement;
    const observer = tagRoomObserver();
    let time: HTMLElement | null = null;
    let placed = "";
    const room: TagRoom = {
      read() {
        // The time is its row's words' own: read anew, so a time drawn again is the one measured.
        const found = box.querySelector<HTMLElement>("[data-menu-time]");
        if (found !== time) {
          if (time !== null) {
            observer?.unobserve(time);
            tagRooms.delete(time);
          }
          time = found;
          if (found !== null) {
            tagRooms.set(found, room);
            observer?.observe(found);
          }
        }
        const width = tag.offsetWidth;
        const timeWidth =
          found === null || found.offsetWidth === 0 ? 0 : found.offsetWidth + TAG_TIME_GAP_PX;
        // Only a width that changed moves the tag: a reading that changed nothing writes nothing,
        // so the observer never answers its own write.
        const reading = `${String(width)} ${String(timeWidth)}`;
        if (reading === placed) return null;
        placed = reading;
        return () => {
          box.toggleAttribute("data-tags", width > 0);
          box.style.setProperty("--menu-tags-w", `${String(width)}px`);
          box.style.setProperty("--menu-time-w", `${String(timeWidth)}px`);
        };
      },
    };
    if (observer === null) {
      // Nothing to hear the layout from: measured here, as it was.
      room.read()?.();
      return;
    }
    tagRooms.set(tag, room);
    observer.observe(tag);
    return () => {
      observer.unobserve(tag);
      tagRooms.delete(tag);
      if (time !== null) {
        observer.unobserve(time);
        tagRooms.delete(time);
      }
    };
  }, [present, row, tags]);
}

/** One row's tag room: its widths read, and what to write for them, or nothing where none moved. */
interface TagRoom {
  readonly read: () => (() => void) | null;
}

const tagRooms = new Map<Element, TagRoom>();
let tagRoomsHeard: ResizeObserver | null = null;

/**
 * The one observer every row's tag and time are heard from. The browser calls it once it has laid
 * the page out and before it paints, with every row that changed: all their widths are read, then
 * all are written, so the menu's rows share one layout. Measured in each row's own layout effect,
 * every row forced a layout of its own for the widths the row before it had just written — 68 of
 * them in one load of the menu.
 */
function tagRoomObserver(): ResizeObserver | null {
  if (typeof ResizeObserver === "undefined") return null;
  tagRoomsHeard ??= new ResizeObserver((entries) => {
    const rooms = new Set<TagRoom>();
    for (const entry of entries) {
      const room = tagRooms.get(entry.target);
      if (room !== undefined) rooms.add(room);
    }
    const writes = [...rooms].map((room) => room.read());
    for (const write of writes) write?.();
  });
  return tagRoomsHeard;
}
