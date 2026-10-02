import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { MATE_LINK_TEXT_MAX, MateLinkDown, MateLinkUp, linkText } from "./mateLink.ts";

const decodeUp = Schema.decodeUnknownExit(Schema.fromJsonString(MateLinkUp));
const decodeDown = Schema.decodeUnknownExit(Schema.fromJsonString(MateLinkDown));

const summary = (lastRequest: string) =>
  JSON.stringify({
    type: "summary",
    summary: {
      main: {
        threadId: "t1",
        status: "working",
        lastRequest,
        lastWords: null,
        lastTurnAt: "2026-10-02T10:00:00Z",
        waitingQuestion: null,
        firstError: null,
        liveStep: "Reading src/app.ts",
      },
      running: 1,
      waiting: 0,
      signers: { "claude-code": "U1" },
    },
  });

describe("mateLink", () => {
  it("reads a summary within its bounds, and refuses one past them", () => {
    expect(decodeUp(summary("Add a login page"))._tag).toBe("Success");
    expect(decodeUp(summary("x".repeat(MATE_LINK_TEXT_MAX + 1)))._tag).toBe("Failure");
    expect(decodeUp(JSON.stringify({ type: "summary", summary: { running: -1 } }))._tag).toBe(
      "Failure",
    );
  });

  it("brings the Mate's own changes down with its state, and reads a newer HQ's state too", () => {
    const state = (extra: Record<string, unknown>) =>
      JSON.stringify({
        type: "state",
        mate: {
          projectId: "P_MATE",
          name: "Ada",
          face: "face-1",
          standupRequestedBy: null,
          closedOff: true,
          appId: "A1",
          changes: [
            {
              repo: "appdev",
              number: 7,
              state: "merged",
              head: "a".repeat(40),
              mergedSha: "b".repeat(40),
              landedHead: "a".repeat(40),
            },
          ],
          ...extra,
        },
      });
    expect(decodeDown(state({}))._tag).toBe("Success");
    // A field this build does not know is passed by, so an older Mate reads a newer HQ.
    expect(decodeDown(state({ releases: [] }))._tag).toBe("Success");
    expect(decodeDown(state({ changes: [{ repo: "appdev" }] }))._tag).toBe("Failure");

    // Its application by name, as HQ names it now; an older HQ's state names none.
    const appName = (extra: Record<string, unknown>) => {
      const decoded = decodeDown(state(extra));
      return decoded._tag === "Success" && decoded.value.type === "state"
        ? decoded.value.mate.appName
        : decoded._tag;
    };
    expect(appName({ appName: "Shop" })).toBe("Shop");
    expect(appName({ appName: null })).toBeNull();
    expect(appName({})).toBeNull();
    expect(appName({ appName: 7 })).toBe("Failure");
  });

  it("cuts a text to what a summary carries", () => {
    expect(linkText("short")).toBe("short");
    const cut = linkText("y".repeat(MATE_LINK_TEXT_MAX + 50));
    expect(cut.length).toBe(MATE_LINK_TEXT_MAX);
    expect(cut.endsWith("…")).toBe(true);
  });
});
