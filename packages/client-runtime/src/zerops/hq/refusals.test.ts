import { describe, expect, it } from "@effect/vitest";
import { MERGE_REFUSALS } from "@t3tools/shared/hqChanges";
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
    ["change_not_found", "change_not_found", "HQ has no such change."],
    ["change_not_open", "conflict", "This change is merged or closed already."],
    ["recipe_too_large", "too_large", "This project's recipe is too large to read here."],
    // An application's environments and their deploy keys (SPEC §3.2b).
    ["environment_with_kind", "invalid", "Only a stage or a production is an environment."],
    ["environment_name_missing", "invalid", "An environment needs a name."],
    [
      "environment_name_invalid",
      "invalid",
      "An environment's name starts with a letter and has only small letters, digits and dashes.",
    ],
    ["environment_name_taken", "conflict", "This project has an environment of that name already."],
    ["environment_not_found", "environment_not_found", "HQ has no such environment."],
    ["deploy_token_refused", "invalid", "Zerops did not accept this deploy key."],
    ["deploy_token_scope", "invalid", "This deploy key reaches more than its own project."],
    // A deploy asked again ("Run again").
    ["deploy_not_found", "deploy_not_found", "HQ has no such deploy."],
    ["deploy_superseded", "conflict", "A newer deploy took this one's place."],
    ["deploy_not_failed", "conflict", "This deploy has not failed."],
  ])("says the structure's own %s in words", (reason, code, words) => {
    expect(hqRefusalWords({ code, reason })).toBe(words);
  });

  it.each([...MERGE_REFUSALS])("says why HQ did not merge, %s, in words of its own", (reason) => {
    const words = hqRefusalWords({ code: "conflict", reason });
    expect(words).not.toContain(reason);
    expect(words).toMatch(/^[A-Z].*\.$/u);
  });

  // A merge refused (`MERGE_REFUSALS`): what stopped it, so the person knows whether pressing again
  // can help — only where main moved meanwhile.
  it.each([
    ["head_moved", "Its Mate pushed to it since you opened it. Review it again."],
    ["conflict", "It no longer merges cleanly into main."],
    ["empty", "There is nothing in it that main does not have."],
    ["already_merged", "It is on main already."],
    ["unrelated", "It shares no history with main."],
    ["no_change", "Nothing was pushed to it yet."],
    ["main_moved", "Other changes kept landing on main meanwhile. Try again."],
    ["change_not_open", "This change is merged or closed already."],
  ])("says %s as it stands", (reason, words) => {
    expect(hqRefusalWords({ code: "conflict", reason })).toBe(words);
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
