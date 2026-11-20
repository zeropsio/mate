import { expect, it } from "vite-plus/test";
import { deleteMateConfirmed } from "./ZeropsDeleteMateDialog.logic.ts";

// witness: apps/web/src/components/zerops/ZeropsDeleteMateDialog.logic.ts | return trimmed.length > 0 && trimmed === name; → return trimmed.length > 0 && trimmed.replace(/\s+/gu, "") === name.replace(/\s+/gu, "");
it("MN8: Deleting a Mate is confirmed only by its name typed as spelled, spaces inside included", () => {
  expect(deleteMateConfirmed("Rye Two", "Rye Two")).toBe(true);
  expect(deleteMateConfirmed("  Rye Two ", "Rye Two")).toBe(true);
  expect(deleteMateConfirmed("RyeTwo", "Rye Two")).toBe(false);
  expect(deleteMateConfirmed("Rye  Two", "Rye Two")).toBe(false);
  expect(deleteMateConfirmed("rye two", "Rye Two")).toBe(false);
  expect(deleteMateConfirmed("   ", "Rye Two")).toBe(false);
});
