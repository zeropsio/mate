import {
  CrewProposalError,
  EnvironmentAuthorizationError,
  AuthOrchestrationOperateScope,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  crewProposeWith,
  crewProposalFailure,
  crewStartState,
  crewSuggestState,
} from "./CrewSetup.logic";

describe("crewSuggestState", () => {
  it.each([
    {
      title: "waits for the goal, and says so",
      input: { goal: "  ", busy: false, unavailable: null },
      state: { disabled: true, reason: "Write the goal first." },
    },
    {
      title: "says why the Mate's agent may not propose for this person",
      input: { goal: "A tea shop.", busy: false, unavailable: "Signed in by someone else." },
      state: { disabled: true, reason: "Signed in by someone else." },
    },
    {
      title: "waits without a reason while the crew home is being written",
      input: { goal: "A tea shop.", busy: true, unavailable: null },
      state: { disabled: true, reason: null },
    },
    {
      title: "may be pressed once there is a goal",
      input: { goal: "A tea shop.", busy: false, unavailable: null },
      state: { disabled: false, reason: null },
    },
  ])("suggesting a crew $title", ({ input, state }) => {
    expect(crewSuggestState(input)).toEqual(state);
  });
});

describe("crewStartState", () => {
  const ready = {
    goal: "A tea shop.",
    drafted: true,
    blocked: false,
    lock: null,
  };
  it.each([
    {
      title: "waits for someone on it first",
      input: { ...ready, drafted: false },
      state: { disabled: true, reason: "Pick who's on it first." },
    },
    {
      title: "waits for the goal, and says so beside it",
      input: { ...ready, goal: "" },
      state: { disabled: true, reason: "Write the goal first." },
    },
    {
      title: "says why the viewer may not start it",
      input: { ...ready, lock: "Signed in by another project member." },
      state: { disabled: true, reason: "Signed in by another project member." },
    },
    {
      title: "waits without words while something else holds it",
      input: { ...ready, blocked: true },
      state: { disabled: true, reason: null },
    },
    {
      title: "starts once there is a goal and someone on it",
      input: ready,
      state: { disabled: false, reason: null },
    },
  ])("starting the crew $title", ({ input, state }) => {
    expect(crewStartState(input)).toEqual(state);
  });
});

describe("crewProposalFailure", () => {
  it.each([
    {
      title: "the gate's own words when the agent may not run",
      cause: new CrewProposalError({ reason: "refused", detail: "Claude's sign-in has expired." }),
      words: "Claude's sign-in has expired.",
    },
    {
      title: "plain words when the agent answered no crew",
      cause: new CrewProposalError({ reason: "malformed", detail: null }),
      words: "Nova answered with something that isn't a crew.",
    },
    {
      title: "the door's words when the session may not ask",
      cause: new EnvironmentAuthorizationError({
        message: "This session can't change Nova.",
        requiredScope: AuthOrchestrationOperateScope,
      }),
      words: "This session can't change Nova.",
    },
    {
      title: "plain words for anything else",
      cause: new Error("socket closed"),
      words: "Nova couldn't propose a crew this time.",
    },
  ])("says why no crew was proposed: $title", ({ cause, words }) => {
    expect(crewProposalFailure(cause, "Nova")).toBe(words);
  });
});

describe("crewProposeWith", () => {
  const modelSelection = {
    instanceId: ProviderInstanceId.make("claude"),
    model: "claude-sonnet-4-5",
  };
  const lock = (ownership: "someone-else" | "unrecorded") => ({
    login: "claude",
    agentId: "claude-code" as const,
    ownership,
  });
  it.each([
    {
      title: "on the agent the Mate's chat runs",
      input: { modelSelection, lock: null },
      with: { kind: "ready", modelSelection },
    },
    {
      title: "nowhere while that agent is somebody else's sign-in",
      input: { modelSelection, lock: lock("someone-else") },
      with: {
        kind: "unavailable",
        words: "Nova's agent was signed in by another project member\u00a0— only they can ask it.",
      },
    },
    {
      title: "nowhere while the Mate has no chat",
      input: { modelSelection: undefined, lock: null },
      with: { kind: "unavailable", words: "Nova has no conversation to propose from yet." },
    },
    {
      title: "nowhere on a Mate from before proposals, saying it needs an update",
      input: { modelSelection, lock: null, capabilities: {} },
      with: { kind: "unavailable", words: "Update Nova to get a proposal." },
    },
    {
      title: "not yet while the Mate's server is not read",
      input: { modelSelection, lock: null, capabilities: undefined },
      with: { kind: "reading" },
    },
  ])("asks for a proposal $title", ({ input, with: expected }) => {
    expect(
      crewProposeWith({ capabilities: { crewProposals: true }, ...input, mateName: "Nova" }),
    ).toEqual(expected);
  });
});
