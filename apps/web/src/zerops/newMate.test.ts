import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { newMateView, useMateHandOver, useNewMateDialog } from "./newMate";

beforeEach(() => {
  useNewMateDialog.setState({ asked: null });
  useMateHandOver.setState({ handOver: null });
});

// The owner, 2026-09-29: the + "leaves the conversation". It asks, and the dialog answers over
// whatever is on screen; nothing navigates.
describe("asking for a Mate", () => {
  it("opens one ask for the project, and a second ask replaces it", () => {
    useNewMateDialog.getState().ask("g-acme");
    expect(useNewMateDialog.getState().asked?.groupId).toBe("g-acme");
    useNewMateDialog.getState().ask("g-beta");
    expect(useNewMateDialog.getState().asked?.groupId).toBe("g-beta");
    useNewMateDialog.getState().dismiss();
    expect(useNewMateDialog.getState().asked).toBeNull();
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

// The route changes under a new Mate's view as it hands over: the conversation it hands over to is
// kept read from above every view meanwhile, so the conversation paints the view's last frame.
describe("the hand-over", () => {
  it("holds the conversation handed over to until it is let go", () => {
    const main = scopeThreadRef(EnvironmentId.make("env-quinn"), ThreadId.make("thread-main"));
    useMateHandOver.getState().handingOver(main);
    expect(useMateHandOver.getState().handOver).toEqual(main);
    useMateHandOver.getState().handingOver(null);
    expect(useMateHandOver.getState().handOver).toBeNull();
  });
});
