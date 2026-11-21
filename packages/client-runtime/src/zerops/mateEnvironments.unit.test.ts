import { expect, it } from "vite-plus/test";

import type { ZeropsCandidate } from "./candidates.ts";
import { deleteMateOffered } from "./mateEnvironments.ts";

/** A running Mate container in an active project: a Mate whose Delete hangs only on the viewer. */
const MATE: ZeropsCandidate = {
  key: "p-mate:s-zcp",
  group: "connected",
  project: { id: "p-mate", name: "mate", status: "ACTIVE" },
  service: { id: "s-zcp", name: "zcp", status: "ACTIVE" },
};

// witness: packages/client-runtime/src/zerops/mateEnvironments.ts | !input.deleting && → true &&
it("ZV155: A Mate this tab asked the platform to delete is not offered Delete again while the listing still holds it; breaks: a second Delete pressed on a Mate whose first one is under way", () => {
  expect(deleteMateOffered({ candidate: MATE, mayDelete: true, deleting: false })).toBe(true);
  expect(deleteMateOffered({ candidate: MATE, mayDelete: true, deleting: true })).toBe(false);
});
