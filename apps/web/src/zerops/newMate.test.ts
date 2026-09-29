import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { newMateView, useNewMate } from "./newMate";

const QUINN = {
  projectId: "p-quinn",
  groupId: "g-acme",
  groupName: "Acme Docs",
  botName: "Quinn",
  face: { tint: "coral", shape: "gem" },
} as const;

beforeEach(() => {
  useNewMate.setState({ creations: {}, handOver: null });
});

describe("where a new Mate lives until it is up", () => {
  it("is its own view, by the project the platform made for it", () => {
    expect(newMateView("p-quinn")).toEqual({
      to: "/mate/$projectId",
      params: { projectId: "p-quinn" },
    });
  });
});

describe("the creations this tab made", () => {
  it("forgets one whose project is gone", () => {
    useNewMate.setState({ creations: { "p-quinn": QUINN } });
    useNewMate.getState().forget("p-quinn");
    expect(useNewMate.getState().creations).toEqual({});
  });
});

// The route changes under a new Mate's view as it hands over: the conversation it hands over to is
// kept read from above every view meanwhile, so the conversation paints the view's last frame.
describe("the hand-over", () => {
  it("holds the conversation handed over to until it is let go", () => {
    const main = scopeThreadRef(EnvironmentId.make("env-quinn"), ThreadId.make("thread-main"));
    useNewMate.getState().handingOver(main);
    expect(useNewMate.getState().handOver).toEqual(main);
    useNewMate.getState().handingOver(null);
    expect(useNewMate.getState().handOver).toBeNull();
  });
});
