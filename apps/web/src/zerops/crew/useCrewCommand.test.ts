import { CrewCommandError, EnvironmentAuthorizationError } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { crewFailureSentence } from "./useCrewCommand";

describe("crewFailureSentence", () => {
  it.each<{ readonly name: string; readonly cause: unknown; readonly sentence: string }>([
    {
      name: "a refusal reads as its phrase, with the engine's detail",
      cause: new CrewCommandError({ reason: "handle-taken", detail: "backend" }),
      sentence: "That handle is already taken: backend.",
    },
    {
      name: "a refusal without detail reads as its phrase alone",
      cause: new CrewCommandError({ reason: "no-mention", detail: null }),
      sentence: "Name a crewmate with @, or add a lead to split the work.",
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
