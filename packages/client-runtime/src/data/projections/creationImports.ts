/** HQ's accepted setup identity, independent of the browser press's lifetime. */
import { hqAppsScope, hqPressesScope, placementsScope } from "../families/hqNavigation.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

/** A known setup with no recorded handle stays null; it never borrows another process. */
export const creationImports: Projection<string, Readonly<Record<string, string | null>>> = {
  name: "creationImports",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const imports: Record<string, string | null> = {};
    for (const id of read.members(hqAppsScope(orgId)).ids) {
      const app = read.fact("hqApp", id);
      if (app.kind !== "known") continue;
      for (const birth of app.value.births ?? []) {
        if (birth.projectId != null) imports[birth.projectId] = birth.importProcessId ?? null;
      }
    }
    for (const id of read.members(placementsScope(orgId)).ids) {
      const placement = read.fact("placement", id);
      if (placement.kind !== "known" || placement.value.mate == null) continue;
      imports[id] = placement.value.mate.importProcessId ?? imports[id] ?? null;
    }
    // A press without a handle cannot erase an accepted handle retained by the birth or Mate.
    for (const id of read.members(hqPressesScope(orgId)).ids) {
      const press = read.fact("hqPress", id);
      if (press.kind === "known") imports[id] = press.value.importProcessId ?? imports[id] ?? null;
    }
    return imports;
  },
  equals: sameValue,
};
