import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  RECIPE_PROPOSAL_TITLE,
  RECIPE_TIER_PATHS,
  RecipeTier,
  RecipeTierResponse,
  hasServices,
} from "./hqRecipe.ts";

const readTier = Schema.decodeUnknownExit(RecipeTier);
const readResponse = Schema.decodeUnknownExit(RecipeTierResponse);

describe("hqRecipe", () => {
  it("names each tier's import file as main's group repository laid them out", () => {
    expect(RECIPE_TIER_PATHS).toEqual({
      mate: "0 — AI Agent/import.yaml",
      stage: "3 — Stage/import.yaml",
      production: "4 — Small Production/import.yaml",
    });
    expect(RECIPE_PROPOSAL_TITLE).toBe("Mate: the group's import files");
    expect(readTier("production")._tag).toBe("Success");
    expect(readTier("ai-agent")._tag).toBe("Failure");
  });

  it.each([
    [
      "a tier as zcp writes it",
      "project:\n  name: shop\nservices:\n  - hostname: api\n    type: nodejs@22\n",
      true,
    ],
    ["four-space indentation", "services:\n    - hostname: api\n", true],
    ["a comment on the key", "services: # the group's\n  - hostname: db\n", true],
    ["an empty list", "project:\n  name: shop\nservices: []\n", false],
    ["no services key", "project:\n  name: shop\n", false],
    ["a key with nothing under it", "services:\nproject:\n  name: shop\n", false],
    ["items only under another key", "project:\n  envVariables:\n    - x\nservices:\n", false],
    ["nothing", "", false],
  ])("reads %s as having services: %s", (_name, yaml, expected) => {
    expect(hasServices(yaml)).toBe(expected);
  });

  it("answers a tier present with its file and main's head, or absent", () => {
    const read = (value: unknown) => readResponse(value)._tag;
    expect(
      read({
        state: "present",
        importYaml: "services:\n  - hostname: api\n",
        mainHead: "a".repeat(40),
      }),
    ).toBe("Success");
    expect(read({ state: "absent" })).toBe("Success");
    expect(read({ state: "present", importYaml: "x" })).toBe("Failure");
    expect(read({ state: "unreadable" })).toBe("Failure");
  });
});
