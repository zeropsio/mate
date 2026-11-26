import { expect, it } from "vite-plus/test";
import { confirmNameWords, deleteMateConfirmed } from "./ZeropsDeleteMateDialog.logic.ts";

// witness: apps/web/src/components/zerops/ZeropsDeleteMateDialog.logic.ts | return trimmed.length > 0 && trimmed === name; → return trimmed.length > 0 && trimmed.replace(/\s+/gu, "") === name.replace(/\s+/gu, "");
it("MN8: Deleting a Mate is confirmed only by its name typed as spelled, spaces inside included", () => {
  expect(deleteMateConfirmed("Rye Two", "Rye Two")).toBe(true);
  expect(deleteMateConfirmed("  Rye Two ", "Rye Two")).toBe(true);
  expect(deleteMateConfirmed("RyeTwo", "Rye Two")).toBe(false);
  expect(deleteMateConfirmed("Rye  Two", "Rye Two")).toBe(false);
  expect(deleteMateConfirmed("rye two", "Rye Two")).toBe(false);
  expect(deleteMateConfirmed("   ", "Rye Two")).toBe(false);
});

// witness: apps/web/src/components/zerops/ZeropsDeleteMateDialog.logic.ts | const matches = deleteMateConfirmed(input.typed, input.name); → const matches = deleteMateConfirmed(input.typed.toLowerCase(), input.name.toLowerCase());
it("MN+4: A name field is addressed by its verb and matches only the spelling asked for", () => {
  const cases = [
    { typed: "", verb: "confirm", matches: false },
    { typed: "sample", verb: "confirm", matches: false },
    { typed: "Sample-name", verb: "confirm", matches: false },
    { typed: "  sample-name  ", verb: "confirm", matches: true },
    { typed: "sample-name", verb: "unlock", matches: true },
  ] as const;
  for (const { typed, verb, matches } of cases) {
    const words = confirmNameWords({ name: "sample-name", whose: "the project's", verb, typed });
    expect(words.matches).toBe(matches);
    expect(words.label).toBe(`Type sample-name to ${verb}`);
  }
});
