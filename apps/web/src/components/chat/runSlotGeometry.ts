/** Where each of the chat's lines under `root` stands, by its key, from `from` (a top on screen). */
export function lineTops(root: HTMLElement | null, from: number): ReadonlyMap<string, number> {
  const tops = new Map<string, number>();
  if (typeof root?.querySelectorAll !== "function") return tops;
  for (const line of root.querySelectorAll<HTMLElement>("li[data-chat-row][data-run-key]")) {
    tops.set(line.dataset.runKey!, line.getBoundingClientRect().top - from);
  }
  return tops;
}

/**
 * Where each row under `root` stands — a card of calls and each call in it —
 * by its key, from `from` (the root's top on screen).
 */
export function rowTops(root: HTMLElement | null, from: number): ReadonlyMap<string, number> {
  const tops = new Map<string, number>();
  if (typeof root?.querySelectorAll !== "function") return tops;
  for (const row of root.querySelectorAll<HTMLElement>("[data-chat-row][data-run-key]")) {
    tops.set(row.dataset.runKey!, row.getBoundingClientRect().top - from);
  }
  return tops;
}

/** How tall the first bubble of each row under `root` stands, by the row's key. */
export function bubbleHeights(root: HTMLElement | null): ReadonlyMap<string, number> {
  const heights = new Map<string, number>();
  if (typeof root?.querySelectorAll !== "function") return heights;
  for (const row of root.querySelectorAll<HTMLElement>("[data-chat-row][data-run-key]")) {
    const bubble = row.matches("[data-chat-bubble]")
      ? row
      : row.querySelector<HTMLElement>("[data-chat-bubble]");
    if (bubble !== null) heights.set(row.dataset.runKey!, bubble.getBoundingClientRect().height);
  }
  return heights;
}

/** Where `row` stands among its scroll's lines: from their start, wherever the scroll stands. */
export function topAmongLines(scroll: HTMLElement, row: Element): number {
  return row.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
}

/** The first of the log's rows that reaches into its view, and where it stands among its lines. */
export function rowInView(
  scroll: HTMLElement | null,
  list: HTMLElement | null,
): { readonly key: string; readonly top: number } | null {
  if (scroll === null || list === null || typeof scroll.getBoundingClientRect !== "function") {
    return null;
  }
  const viewTop = scroll.getBoundingClientRect().top;
  for (const row of list.children) {
    const key = (row as HTMLElement).dataset.runKey;
    if (key === undefined || row.getBoundingClientRect().bottom <= viewTop) continue;
    return { key, top: topAmongLines(scroll, row) };
  }
  return null;
}

/** Whether what the person has selected on the page touches `list`: begun in it, ended in it, or dragged across it. */
export function selectionTouches(list: HTMLElement): boolean {
  const selection = typeof getSelection === "function" ? getSelection() : null;
  if (selection === null || selection.isCollapsed) return false;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (selection.getRangeAt(index).intersectsNode(list)) return true;
  }
  return false;
}

/** The row drawn for the chat's line `key` under `root`, if one is. */
export function rowByKey(root: HTMLElement | null, key: string): HTMLElement | null {
  if (typeof root?.querySelectorAll !== "function") return null;
  for (const row of root.querySelectorAll<HTMLElement>("[data-run-key]")) {
    if (row.dataset.runKey === key) return row;
  }
  return null;
}

/** Sets a property of an element's own style, or takes it away; nothing when it says that already. */
function writeStyle(element: HTMLElement, name: string, value: string | null): void {
  if ((element.style.getPropertyValue(name) || null) === value) return;
  if (value === null) element.style.removeProperty(name);
  else element.style.setProperty(name, value);
}

/** An element's padding above and below its content, in pixels. */
function verticalPadding(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
}

/**
 * Says the room the card needs with its history given back: the slot, its gap
 * above it, the card's head and the history's own edges. On a short page the card
 * holds them whole once the history has none left to give. Measured from the
 * history's bottom, the head was left out, and a slot past the cap (a batch
 * deploy's rows) ran out of the card's frame by the head's height.
 */
export function placeSlot(list: HTMLOListElement | null): void {
  // Drawn outside a page (a test's renderer), it has no layout to read.
  if (typeof list?.querySelector !== "function") return;
  const slotBox = list.parentElement;
  const chat = slotBox?.parentElement ?? null;
  if (slotBox === null || chat === null) return;
  // Every box read before anything is written: a write between two reads
  // restyled the card, and the second read laid it out again.
  const slotRect = slotBox.getBoundingClientRect();
  // What the history gives back is its scroll's room: its own edges and the gaps around it stay.
  const scroll =
    slotBox.previousElementSibling?.querySelector<HTMLElement>(":scope > .run-scroll") ?? null;
  const given =
    scroll === null ? 0 : scroll.getBoundingClientRect().height - verticalPadding(scroll);
  const from = chat.getBoundingClientRect().top;
  // Said on the card for its own cap (`@property --run-slot-room`): nothing
  // under it inherits it, so a change of it restyles the card's box alone.
  writeStyle(chat, "--run-slot-room", `${Math.ceil(slotRect.bottom - from - given)}px`);
}

/** How tall a box stands as laid out; null drawn outside a page (a test's renderer). */
export function heightOf(element: HTMLElement | null): number | null {
  return element === null || typeof element.getBoundingClientRect !== "function"
    ? null
    : element.getBoundingClientRect().height;
}
