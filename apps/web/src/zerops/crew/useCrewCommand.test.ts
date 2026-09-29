import { CrewCommandError, EnvironmentAuthorizationError } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  CREW_FAILURE_SHOWN_MS,
  crewFailureAt,
  crewFailureSentence,
  crewRefusalOf,
} from "./useCrewCommand";

describe("crewFailureSentence", () => {
  it.each<{ readonly name: string; readonly cause: unknown; readonly sentence: string }>([
    {
      name: "a refusal reads as the engine's detail, as a sentence, never its code",
      cause: new CrewCommandError({
        reason: "wrong-state",
        detail: "no dev server runs on appdev; start it first",
      }),
      sentence: "No dev server runs on appdev; start it first.",
    },
    {
      name: "a refusal without detail reads as its phrase alone",
      cause: new CrewCommandError({ reason: "no-mention", detail: null }),
      sentence: "Pick who it's for, or add a lead to split the work.",
    },
    {
      name: "an authorization refusal keeps its own words",
      cause: new EnvironmentAuthorizationError({
        message: "Signing in again is needed.",
        requiredScope: "orchestration:operate",
      }),
      sentence: "Signing in again is needed.",
    },
    {
      name: "anything else is a plain failure",
      cause: new Error("socket closed"),
      sentence: "Something went wrong.",
    },
  ])("$name", ({ cause, sentence }) => {
    expect(crewFailureSentence(cause)).toBe(sentence);
  });
});

describe("crewRefusalOf", () => {
  it("names the engine's reason, and nothing for any other failure", () => {
    expect(crewRefusalOf(new CrewCommandError({ reason: "unlanded-commits", detail: null }))).toBe(
      "unlanded-commits",
    );
    expect(crewRefusalOf(new Error("socket closed"))).toBeNull();
  });
});

describe("crewFailureAt", () => {
  const failure = (origin: string | null) => ({ sentence: "That can't be done.", origin });

  it.each([
    {
      name: "a row's failure shows at that row",
      at: "attention:q1",
      failure: failure("attention:q1"),
      shown: true,
    },
    {
      name: "and at no other row",
      at: "attention:q2",
      failure: failure("attention:q1"),
      shown: false,
    },
    {
      name: "and not in the section's own line",
      at: null,
      failure: failure("attention:q1"),
      shown: false,
    },
    {
      name: "a failure no row owns shows in the section's line",
      at: null,
      failure: failure(null),
      shown: true,
    },
    { name: "nothing failed", at: null, failure: null, shown: false },
  ])("$name", ({ at, failure: last, shown }) => {
    expect(crewFailureAt(last, at)).toBe(shown ? "That can't be done." : null);
  });

  it("is shown for about ten seconds", () => {
    expect(CREW_FAILURE_SHOWN_MS).toBe(10_000);
  });
});
