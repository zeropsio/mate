/**
 * How this browser likes its projects ordered — the `/zerops` projects page's
 * sort control, the account menu's *Order* and the left sidebar tree read the
 * same value, live, so switching it in one place turns every surface around
 * together.
 *
 * A per-viewer convenience, not product state: it lives in this browser's
 * `localStorage` alone, under the signed-in account's key, is never sent
 * anywhere, and a private window or a blocked storage policy just falls back
 * to the default rather than failing the page. `useLocalStorage` is the repo's
 * own idiom for exactly this shape (`editorPreferences.ts`, `useTheme.ts`,
 * `Sidebar.tsx`'s shelf toggles): the read, the decode, the write and the
 * cross-tab/same-tab live sync are all already try/catch-guarded there, so
 * nothing is reimplemented here.
 *
 * *Custom* is the viewer's own arrangement of their projects: the group ids in
 * the order they put them, kept beside the mode. Choosing it keeps the order
 * on screen as its starting point, and moving a project from any other order
 * chooses it — the person asked for that project to stand somewhere else, and
 * no other order would keep it there.
 */
import * as Schema from "effect/Schema";
import type { ZeropsProjectOrder } from "@t3tools/client-runtime/zerops";
import { useCallback, useMemo } from "react";

import { useLocalStorage } from "../hooks/useLocalStorage";
import { onAccountLifetimeClose } from "./accountLifetime";

export const PROJECT_ORDER_STORAGE_KEY = "mate:zerops:project-order";
export const PROJECT_CUSTOM_ORDER_STORAGE_KEY = "mate:zerops:project-custom-order";

/** Newest first unless the viewer chose otherwise (the owner, 2026-09-24). */
export const DEFAULT_PROJECT_ORDER: ZeropsProjectOrder = "newest";

export const ProjectOrderSchema = Schema.Literals(["newest", "name", "custom"]);
export const ProjectCustomOrderSchema = Schema.Array(Schema.String);

const NO_CUSTOM_ORDER: ReadonlyArray<string> = [];

/** The three orders, in the words both surfaces offer them. */
export const PROJECT_ORDER_CHOICES: ReadonlyArray<{
  readonly value: ZeropsProjectOrder;
  readonly label: string;
}> = [
  { value: "name", label: "Name" },
  { value: "newest", label: "Creation date" },
  { value: "custom", label: "Custom" },
];

/**
 * The one order both surfaces read and the page's sort control writes —
 * `useLocalStorage`'s `storage` and same-tab change events keep every reader
 * in the same state without any one of them owning it. A stored value that
 * no longer decodes (the removed *Next step first*) reads as the default.
 */
export function useProjectOrderPreference(): readonly [
  ZeropsProjectOrder,
  (next: ZeropsProjectOrder) => void,
] {
  return useLocalStorage(PROJECT_ORDER_STORAGE_KEY, DEFAULT_PROJECT_ORDER, ProjectOrderSchema);
}

/** What `buildZeropsGroupTree` is given: the order, and in *Custom* the arrangement. */
export interface ProjectOrderOptions {
  readonly order: ZeropsProjectOrder;
  readonly customOrder?: ReadonlyArray<string>;
}

export function projectOrderOptionsOf(
  order: ZeropsProjectOrder,
  customOrder: ReadonlyArray<string>,
): ProjectOrderOptions {
  return order === "custom" ? { order, customOrder } : { order };
}

/**
 * `order` with `id` taken out and put back at `to` — clamped to the list, so
 * a place past either end is that end. An id the order does not hold leaves
 * it as it is: there is nothing of it to move.
 */
export function movedInOrder(
  order: ReadonlyArray<string>,
  id: string,
  to: number,
): ReadonlyArray<string> {
  const from = order.indexOf(id);
  if (from === -1) return order;
  const rest = order.filter((entry) => entry !== id);
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * `order` with `id` put in front of `beforeId`, or last where `beforeId` is
 * `null` or not in the order. The surfaces move a project among the ones
 * they draw, so the place is named by a neighbour, never by an index into a
 * list that holds projects nobody sees.
 */
export function movedBefore(
  order: ReadonlyArray<string>,
  id: string,
  beforeId: string | null,
): ReadonlyArray<string> {
  if (beforeId === id) return order;
  const rest = order.filter((entry) => entry !== id);
  const at = beforeId === null ? -1 : rest.indexOf(beforeId);
  return movedInOrder(order, id, at === -1 ? rest.length : at);
}

/** Every reader of the order, and the two ways it changes. */
export interface ProjectOrderControl extends ProjectOrderOptions {
  /**
   * Chooses an order. *Custom* starts from `onScreen` — the order the viewer
   * is looking at — whatever arrangement was kept from before.
   */
  readonly choose: (next: ZeropsProjectOrder, onScreen: ReadonlyArray<string>) => void;
  /**
   * Puts one project in front of `beforeId` (last for `null`) in `onScreen`,
   * which makes the order *Custom*.
   */
  readonly move: (
    groupId: string,
    beforeId: string | null,
    onScreen: ReadonlyArray<string>,
  ) => void;
}

export function useProjectOrder(): ProjectOrderControl {
  const [order, setOrder] = useProjectOrderPreference();
  const [customOrder, setCustomOrder] = useLocalStorage(
    PROJECT_CUSTOM_ORDER_STORAGE_KEY,
    NO_CUSTOM_ORDER,
    ProjectCustomOrderSchema,
  );
  const choose = useCallback(
    (next: ZeropsProjectOrder, onScreen: ReadonlyArray<string>) => {
      if (next === "custom") setCustomOrder([...onScreen]);
      setOrder(next);
    },
    [setCustomOrder, setOrder],
  );
  const move = useCallback(
    (groupId: string, beforeId: string | null, onScreen: ReadonlyArray<string>) => {
      setCustomOrder([...movedBefore(onScreen, groupId, beforeId)]);
      if (order !== "custom") setOrder("custom");
    },
    [order, setCustomOrder, setOrder],
  );
  return { ...projectOrderOptionsOf(order, customOrder), choose, move };
}

/** What a surface builds its group tree with, and nothing it would have to memoize. */
export function useProjectOrderOptions(): ProjectOrderOptions {
  const { order, customOrder } = useProjectOrder();
  return useMemo(
    () => (customOrder === undefined ? { order } : { order, customOrder }),
    [order, customOrder],
  );
}

/**
 * The order the left menu last drew its projects in, by group id — what
 * choosing *Custom* from the account menu starts from, since the menu that
 * offers the choice draws no projects of its own. The tree writes it on every
 * render that changes it; nothing else does.
 */
let projectsOnScreen: ReadonlyArray<string> = NO_CUSTOM_ORDER;
onAccountLifetimeClose(() => {
  projectsOnScreen = NO_CUSTOM_ORDER;
});

export function rememberProjectsOnScreen(groupIds: ReadonlyArray<string>): void {
  projectsOnScreen = groupIds;
}

export function readProjectsOnScreen(): ReadonlyArray<string> {
  return projectsOnScreen;
}
