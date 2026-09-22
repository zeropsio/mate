/**
 * How this browser likes its projects ordered — the `/zerops` projects page's
 * sort control and the left sidebar tree read the same value, live, so
 * switching it in one place turns both around together.
 *
 * A per-viewer convenience, not product state: it lives in this browser's
 * `localStorage` alone, is never sent anywhere, and a private window or a
 * blocked storage policy just falls back to the default rather than failing
 * the page. `useLocalStorage` is the repo's own idiom for exactly this shape
 * (`editorPreferences.ts`, `useTheme.ts`, `Sidebar.tsx`'s shelf toggles): the
 * read, the decode, the write and the cross-tab/same-tab live sync are all
 * already try/catch-guarded there, so nothing is reimplemented here.
 */
import * as Schema from "effect/Schema";
import type { ZeropsProjectOrder } from "@t3tools/client-runtime/zerops";

import { useLocalStorage } from "../hooks/useLocalStorage";

export const PROJECT_ORDER_STORAGE_KEY = "mate:zerops:project-order";

/** Newest first, unless the viewer chose otherwise — spec-mate's simpler
 * take on the legacy dashboard's `created desc` default. */
export const DEFAULT_PROJECT_ORDER: ZeropsProjectOrder = "newest";

export const ZeropsProjectOrderSchema = Schema.Literals(["newest", "name"]);

/**
 * The projects page and the sidebar tree both call this — `useLocalStorage`'s
 * `storage` and same-tab change events keep them in the same state without
 * either one owning the other.
 */
export function useProjectOrderPreference(): readonly [
  ZeropsProjectOrder,
  (next: ZeropsProjectOrder) => void,
] {
  return useLocalStorage(
    PROJECT_ORDER_STORAGE_KEY,
    DEFAULT_PROJECT_ORDER,
    ZeropsProjectOrderSchema,
  );
}
