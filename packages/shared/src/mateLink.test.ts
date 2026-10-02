import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { MATE_LINK_TEXT_MAX, MateLinkUp, linkText } from "./mateLink.ts";

const decodeUp = Schema.decodeUnknownExit(Schema.fromJsonString(MateLinkUp));

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

  it("cuts a text to what a summary carries", () => {
    expect(linkText("short")).toBe("short");
    const cut = linkText("y".repeat(MATE_LINK_TEXT_MAX + 50));
    expect(cut.length).toBe(MATE_LINK_TEXT_MAX);
    expect(cut.endsWith("…")).toBe(true);
  });
});
