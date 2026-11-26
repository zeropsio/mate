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
it("MN94: The field that asks a name typed is pressed by 'Type <name> to confirm', and says it matches only for the name spelled the same, spaces around it aside; breaks: a name with a different capital readies Delete, or the journeys find no field.", () => {
  const cases = [
    { typed: "", matches: false },
    { typed: "sample", matches: false },
    { typed: "Sample-name", matches: false },
    { typed: "  sample-name  ", matches: true },
  ] as const;
  for (const { typed, matches } of cases) {
    const words = confirmNameWords({ name: "sample-name", typed });
    expect(words.state === "matches").toBe(matches);
    expect(words.label).toBe("Type sample-name to confirm");
  }
});

// witness: apps/web/src/components/zerops/ZeropsDeleteMateDialog.logic.ts | if (input.hold != null) → if (input.hold != null && input.typed === "")
it("MN106: The name block says exactly one state: nothing typed, not the same yet, matching but held by what else is missing, or matching; breaks: the block reads Matches while Delete is closed, or the hold is said twice.", () => {
  const cases = [
    {
      typed: "",
      hold: "Slide Production live to confirm it goes.",
      state: "empty",
      line: "Capitals, spaces and dashes count.",
    },
    {
      typed: "sample",
      hold: null,
      state: "differs",
      line: "Not the same yet: capitals, spaces and dashes count.",
    },
    {
      typed: "sample-name",
      hold: "Slide Production live to confirm it goes.",
      state: "held",
      line: "Slide Production live to confirm it goes.",
    },
    { typed: "sample-name", hold: null, state: "matches", line: "Matches" },
  ] as const;
  for (const { typed, hold, state, line } of cases) {
    expect(confirmNameWords({ name: "sample-name", typed, hold })).toEqual({
      label: "Type sample-name to confirm",
      state,
      line,
    });
  }
});
