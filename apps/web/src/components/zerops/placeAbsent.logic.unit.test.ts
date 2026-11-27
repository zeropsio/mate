import { expect, it } from "vite-plus/test";

import { placeAbsent } from "./place/placePage.logic";

// witness: apps/web/src/components/zerops/place/placePage.logic.ts | return input.environmentsTold && input.inventoryRead && input.legacyStops === 0; → return false;
it("MN133: A place's address that names no place of its project says so once HQ told the project's environments and the inventory is read, and waits until both are; breaks: a removed place's link, or an address this version has no page for, stands in with a skeleton forever", () => {
  expect([
    placeAbsent({ environmentsTold: true, inventoryRead: true, legacyStops: 0 }),
    placeAbsent({ environmentsTold: false, inventoryRead: true, legacyStops: 0 }),
    placeAbsent({ environmentsTold: true, inventoryRead: false, legacyStops: 0 }),
    placeAbsent({ environmentsTold: true, inventoryRead: true, legacyStops: 1 }),
  ]).toEqual([true, false, false, false]);
});
