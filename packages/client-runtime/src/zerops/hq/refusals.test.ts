import { describe, expect, it } from "@effect/vitest";
import { REASONS } from "@t3tools/shared/zeropsPermissions";

import { hqRefusalWords } from "./refusals.ts";

describe("hqRefusalWords — HQ's refusal, in the person's words", () => {
  it.each([...REASONS])("says %s in words of its own, never the code", (reason) => {
    const words = hqRefusalWords({ code: "forbidden", reason });
    expect(words).not.toContain(reason);
    expect(words).toMatch(/^[A-Z].*\.$/u);
  });

  it("offers no remedy for a kind it does not know that reloading cannot give: the kind is HQ's", () => {
    expect(hqRefusalWords({ code: "forbidden", reason: "unknown_kind" })).toBe(
      "HQ and this version of Mate do not know the same kinds of project, so this one is left as it is.",
    );
  });

  it.each([
    ["app_name_taken", "conflict", "Another project already has this name."],
    ["held_changed", "conflict", "Somebody changed this project in HQ meanwhile. Try again."],
    ["name_length", "invalid", "A name has 1 to 100 characters."],
  ])("says the structure's own %s in words", (reason, code, words) => {
    expect(hqRefusalWords({ code, reason })).toBe(words);
  });

  it("names a refusal this build has no words for by its code", () => {
    expect(hqRefusalWords({ code: "conflict", reason: "newer_rule" })).toBe(
      "HQ refused this (newer_rule).",
    );
    expect(hqRefusalWords({ code: "too_large", reason: undefined })).toBe(
      "HQ refused this (too_large).",
    );
  });
});
