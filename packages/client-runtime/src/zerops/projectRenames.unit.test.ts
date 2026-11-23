import { expect, it } from "vite-plus/test";

import { renameStillDue } from "./projectRenames.ts";

// witness: packages/client-runtime/src/zerops/projectRenames.ts | return left !== undefined && left.from.trim() === currentName.trim() ? left : undefined; → return left !== undefined ? left : undefined;
it("ZV50: A rename left over is offered to finish only while its project still bears the name it was planned from", () => {
  const left = { projectId: "p1", from: "SPN - Rune", to: "Shop - Rune" };
  expect(renameStillDue(left, " SPN - Rune ")).toEqual(left);
  expect(renameStillDue(left, "Shop - Rune")).toBeUndefined();
  expect(renameStillDue(left, "Milo")).toBeUndefined();
  expect(renameStillDue(undefined, "SPN - Rune")).toBeUndefined();
});
