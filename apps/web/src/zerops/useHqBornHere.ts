import { useState } from "react";

import type { HqGate } from "./hqGate";
import { hqBirthView, useHqBirths, watchHqBirth, type HqBirthWatch } from "./hqBirth";
import { useMenuRows } from "./useMenuRows";
import { useZeropsSession } from "./ZeropsSessionProvider";

const NO_ROWS: ReadonlyArray<never> = [];

/** The gate's page the finished setup is drawn with: its birth, at its end. */
export const HQ_BORN_HERE: HqGate & { readonly kind: "birth" } = { kind: "birth" };

/**
 * Whether the organization's HQ, whose setup this page watched finish, still waits for the menu to
 * read it (`watchHqBirth`): the finished setup stands in the page meanwhile.
 */
export function useHqBornHere(): boolean {
  const organizationId = useZeropsSession().activeOrganization?.id ?? "";
  const birth = hqBirthView(useHqBirths(organizationId));
  const menuSettled = useMenuRows(NO_ROWS).settled;
  const [watched, setWatched] = useState<{
    readonly organizationId: string;
    readonly watch: HqBirthWatch;
  }>({ organizationId, watch: "unseen" });
  const from = watched.organizationId === organizationId ? watched.watch : "unseen";
  const watch = watchHqBirth(from, { birth, menuSettled });
  if (watch !== watched.watch || watched.organizationId !== organizationId)
    setWatched({ organizationId, watch });
  return watch === "born";
}
