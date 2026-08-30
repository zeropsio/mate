import { describe, expect, it } from "vite-plus/test";

import {
  ZEROPS_FIRST_PROMPT_STORAGE_KEY,
  ZEROPS_ONBOARDING_PROMPT,
  parseFirstPromptMarkers,
  shouldComposeFirstPrompt,
  withFirstPromptComposed,
} from "./firstPrompt.ts";

describe("shouldComposeFirstPrompt", () => {
  it("composes once for a freshly connected Zerops environment", () => {
    expect(
      shouldComposeFirstPrompt({
        environmentId: "env-1",
        alreadyComposed: [],
        connectedVia: "zerops-identity",
      }),
    ).toBe(true);
  });

  it("stays quiet on every reconnect to the same environment", () => {
    expect(
      shouldComposeFirstPrompt({
        environmentId: "env-1",
        alreadyComposed: ["env-0", "env-1"],
        connectedVia: "zerops-identity",
      }),
    ).toBe(false);
  });

  it("never writes into an environment somebody paired by hand", () => {
    expect(
      shouldComposeFirstPrompt({
        environmentId: "env-2",
        alreadyComposed: [],
        connectedVia: "pairing",
      }),
    ).toBe(false);
  });

  it("does nothing without an environment to key on", () => {
    expect(
      shouldComposeFirstPrompt({
        environmentId: "",
        alreadyComposed: [],
        connectedVia: "zerops-identity",
      }),
    ).toBe(false);
  });
});

describe("first-prompt markers", () => {
  it("records an environment once", () => {
    expect(withFirstPromptComposed([], "env-1")).toEqual(["env-1"]);
    expect(withFirstPromptComposed(["env-1"], "env-1")).toEqual(["env-1"]);
    expect(withFirstPromptComposed(["env-1"], "env-2")).toEqual(["env-1", "env-2"]);
  });

  it("treats a corrupt record as nothing composed, never as everything composed", () => {
    expect(parseFirstPromptMarkers(null)).toEqual([]);
    expect(parseFirstPromptMarkers("{not json")).toEqual([]);
    expect(parseFirstPromptMarkers('{"env-1":true}')).toEqual([]);
    expect(parseFirstPromptMarkers('["env-1",7,"",{}]')).toEqual(["env-1"]);
  });

  it("keeps its own versioned key", () => {
    expect(ZEROPS_FIRST_PROMPT_STORAGE_KEY).toMatch(/\.v\d+$/);
  });

  it("opens with something the agent can actually answer", () => {
    expect(ZEROPS_ONBOARDING_PROMPT).toContain("Zerops Code");
    expect(ZEROPS_ONBOARDING_PROMPT.length).toBeLessThan(240);
  });
});
