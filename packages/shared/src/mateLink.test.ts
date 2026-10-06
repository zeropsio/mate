import { MATE_ATTENTION_IDS_MAX } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  MATE_LINK_FRAME_MAX,
  MATE_LINK_TEXT_MAX,
  MateLinkDown,
  LoginDigest,
  MateLinkUp,
  linkFrameBytes,
  readLinkUp,
} from "./mateLink.ts";

const decodeUp = Schema.decodeUnknownExit(Schema.fromJsonString(MateLinkUp));
const decodeDown = Schema.decodeUnknownExit(Schema.fromJsonString(MateLinkDown));

/** The summary a Mate from before the overview sent. */
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

const AT = "2026-10-03T10:00:00.000Z";

/** A Mate's whole overview, every section in it: its main chat waits on a question. */
const overview = {
  identity: { environmentId: "env-ada", serverVersion: "0.11.90", update: null },
  main: {
    id: "t1",
    title: "Add a login page",
    hasPendingApprovals: false,
    hasPendingUserInput: true,
    hasActionableProposedPlan: false,
    interactionMode: "default",
    backgroundLiveness: null,
    session: { status: "ready", lastError: null },
    latestTurn: {
      turnId: "turn-1",
      state: "completed",
      requestedAt: AT,
      startedAt: AT,
      completedAt: AT,
    },
    latestUserMessageAt: AT,
    updatedAt: AT,
    latestUserMessagePreview: { text: "Add a login page" },
    latestMessagePreview: { role: "assistant", text: "Which provider should it use?" },
    planProgress: null,
    pendingQuestion: "Which provider should it use?",
    usagePause: null,
    liveStep: {
      kind: "calls",
      since: AT,
      calls: [
        {
          id: "call-1",
          activityKind: "tool.updated",
          itemType: "command_execution",
          title: "Command run",
          detail: "Bash: pnpm build",
          toolName: "Bash",
          command: "pnpm build",
          startedAt: AT,
        },
      ],
    },
  },
  threads: {
    list: [
      {
        id: "t1",
        title: "Add a login page",
        kind: "input",
        turnId: "turn-1",
        turnState: "completed",
        completedAt: AT,
      },
      {
        id: "t2",
        title: "New thread",
        kind: "idle",
        turnId: null,
        turnState: null,
        completedAt: null,
      },
    ],
    omitted: 3,
  },
  logins: { "claude-code": { signedInBy: "U1", present: true, token: false } },
  crew: {
    status: "applied",
    crewmates: [
      {
        handle: "fen",
        displayName: "Fen",
        tint: "teal",
        lead: true,
        threadId: "t9",
        threadKind: "working",
        loginKey: "claude-code",
      },
    ],
    attention: [{ id: "question:a1", kind: "question", handle: "fen" }],
    readyTasks: [{ id: "task-1", owner: "fen" }],
    personLands: true,
  },
};

describe("mateLink", () => {
  it("decodes an overview a Mate sends with every section", () => {
    const decoded = decodeUp(JSON.stringify({ type: "overview", full: true, overview }));
    expect(decoded._tag === "Success" ? decoded.value : decoded._tag).toEqual({
      type: "overview",
      full: true,
      overview,
    });
  });

  it("carries a crew's status, and its digest only once one is applied", () => {
    const crewOf = (crew: unknown) => {
      const decoded = decodeUp(
        JSON.stringify({ type: "overview", full: false, sections: { crew } }),
      );
      return decoded._tag === "Success" && decoded.value.type === "overview" && !decoded.value.full
        ? decoded.value.sections.crew
        : decoded._tag;
    };
    // Crew mode off, and on with no crew yet: the menu offers nothing, or *Set up a crew*.
    expect(crewOf({ status: "off" })).toEqual({ status: "off" });
    expect(crewOf({ status: "none" })).toEqual({ status: "none" });
    // Applied: its digest beside its status.
    expect(crewOf(overview.crew)).toEqual(overview.crew);
    expect(crewOf({ status: "applied" })).toBe("Failure");
    expect(crewOf(null)).toBe("Failure");
  });

  it("decodes a frame that names only the sections that changed", () => {
    const decoded = decodeUp(
      JSON.stringify({
        type: "overview",
        full: false,
        sections: { main: null, crew: { status: "none" } },
      }),
    );
    expect(decoded._tag === "Success" ? decoded.value : decoded._tag).toEqual({
      type: "overview",
      full: false,
      sections: { main: null, crew: { status: "none" } },
    });
  });

  it("passes by a frame whose type this build does not know", () => {
    expect(readLinkUp(JSON.stringify({ type: "usage", windows: [] }))).toEqual({
      kind: "unknown",
      type: "usage",
    });
    expect(readLinkUp(JSON.stringify({ type: "pong" }))).toEqual({
      kind: "message",
      message: { type: "pong" },
    });
  });

  // A Mate from before the overview sends its summary: HQ passes it by and keeps the link.
  it("passes by an older Mate's summary as a type this build does not know", () => {
    expect(readLinkUp(summary("Add a login page"))).toEqual({ kind: "unknown", type: "summary" });
    expect(readLinkUp(JSON.stringify({ type: "summary", summary: { running: -1 } }))).toEqual({
      kind: "unknown",
      type: "summary",
    });
  });

  it("refuses a known type whose body does not decode", () => {
    const long = { ...overview, main: { ...overview.main, title: "x".repeat(121) } };
    const { crew: _crew, ...partial } = overview;
    for (const frame of [
      JSON.stringify({ type: "overview", full: true, overview: long }),
      JSON.stringify({ type: "overview", full: true, overview: partial }),
      JSON.stringify({ type: "overview", full: false, overview }),
      JSON.stringify({ kind: "overview" }),
      JSON.stringify(["pong"]),
      "not a frame",
    ]) {
      expect(readLinkUp(frame)).toEqual({ kind: "invalid" });
    }
  });

  it("counts a frame's size in UTF-8 bytes", () => {
    // One, two, three and four bytes: a JavaScript string's length would say five.
    expect(linkFrameBytes("aé€😀")).toBe(10);
    expect(MATE_LINK_FRAME_MAX).toBe(64 * 1024);
    // The largest overview the bounds allow fits a frame, whatever script its texts are in.
    const wide = "ж".repeat(MATE_LINK_TEXT_MAX);
    const thread = (n: number) => ({
      ...overview.threads.list[0]!,
      id: `t${n}`,
      title: "ж".repeat(120),
    });
    const largest = {
      type: "overview",
      full: true,
      overview: {
        ...overview,
        main: {
          ...overview.main,
          title: "ж".repeat(120),
          latestUserMessagePreview: { text: wide },
          latestMessagePreview: { role: "assistant", text: wide },
          planProgress: { step: wide },
          pendingQuestion: wide,
        },
        threads: { list: Array.from({ length: 40 }, (_, n) => thread(n)), omitted: 0 },
      },
    };
    expect(readLinkUp(JSON.stringify(largest)).kind).toBe("message");
    expect(linkFrameBytes(JSON.stringify(largest))).toBeLessThan(MATE_LINK_FRAME_MAX);
  });

  it("reads a Mate's attention at its bound within a frame, and refuses one past it", () => {
    const id = (n: number) => `${"0".repeat(32)}-${String(n).padStart(3, "0")}`;
    const attention = (results: number) => ({
      type: "attention",
      attention: {
        source: { environmentId: "env-1", incarnation: id(0), revision: 7 },
        mainThreadId: id(0),
        lastThreadId: id(1),
        working: 3,
        waiting: MATE_ATTENTION_IDS_MAX + 9,
        results: Array.from({ length: results }, (_, n) => ({
          threadId: id(n),
          turnId: id(n),
          completedAt: "2026-10-06T10:00:00.000Z",
        })),
        questions: Array.from({ length: MATE_ATTENTION_IDS_MAX }, (_, n) => ({
          threadId: id(n),
          kind: "input",
          turnId: id(n),
        })),
        truncated: true,
      },
    });
    const largest = JSON.stringify(attention(MATE_ATTENTION_IDS_MAX));
    expect(readLinkUp(largest).kind).toBe("message");
    expect(linkFrameBytes(largest)).toBeLessThan(MATE_LINK_FRAME_MAX);
    expect(readLinkUp(JSON.stringify(attention(MATE_ATTENTION_IDS_MAX + 1)))).toEqual({
      kind: "invalid",
    });
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

    // Each change by its title, so zcp tells its proposals apart; an older HQ's names none.
    const titles = (change: Record<string, unknown>) => {
      const decoded = decodeDown(
        state({
          changes: [
            {
              repo: "group",
              number: 2,
              state: "open",
              head: null,
              mergedSha: null,
              landedHead: null,
              ...change,
            },
          ],
        }),
      );
      return decoded._tag === "Success" && decoded.value.type === "state"
        ? decoded.value.mate.changes.map((each) => each.title)
        : decoded._tag;
    };
    expect(titles({ title: "Mate: the group's import files" })).toEqual([
      "Mate: the group's import files",
    ]);
    expect(titles({})).toEqual([null]);
    expect(titles({ title: 7 })).toBe("Failure");
  });
});

const decodeLogin = Schema.decodeUnknownSync(LoginDigest);
it("carries display ownership separately from current signer authority", () => {
  expect(
    decodeLogin({ signedInBy: null, lastSignedInBy: "U1", present: false, token: false }),
  ).toEqual({ signedInBy: null, lastSignedInBy: "U1", present: false, token: false });
});
