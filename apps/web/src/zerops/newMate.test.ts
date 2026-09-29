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
  useNewMate.setState({ asked: null, creations: {}, handOver: null });
});

// The owner, 2026-09-29: the + "leaves the conversation". It asks, and the dialog answers over
// whatever is on screen; nothing navigates.
describe("asking for a Mate", () => {
  it("opens one ask for the project, and a second ask replaces it", () => {
    useNewMate.getState().ask("g-acme");
    expect(useNewMate.getState().asked?.groupId).toBe("g-acme");
    useNewMate.getState().ask("g-beta");
    expect(useNewMate.getState().asked?.groupId).toBe("g-beta");
    useNewMate.getState().dismiss();
    expect(useNewMate.getState().asked).toBeNull();
  });
});

describe("where Add lands", () => {
  it("is the new Mate's own view, by the project the platform made for it", () => {
    expect(newMateView("p-quinn")).toEqual({
      to: "/mate/$projectId",
      params: { projectId: "p-quinn" },
    });
  });
});

// A creation the platform took is this tab's to speak for until it is through: a step failing
// after that is said in its row and its view, never lost with the dialog.
describe("the creations this tab made", () => {
  it.each([
    { case: "through", failed: undefined },
    { case: "stopped on a step", failed: "The agent container could not be imported" },
  ])("keeps one that ran $case", ({ failed }) => {
    useNewMate.getState().created(QUINN);
    useNewMate.getState().settled("p-quinn", failed);
    expect(useNewMate.getState().creations["p-quinn"]).toEqual({ ...QUINN, failed });
  });

  it("says nothing of a project it did not make", () => {
    useNewMate.getState().settled("p-else", "gone");
    expect(useNewMate.getState().creations).toEqual({});
  });

  it("forgets one whose project is gone", () => {
    useNewMate.getState().created(QUINN);
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
