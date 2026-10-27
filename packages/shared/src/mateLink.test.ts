import { MATE_ATTENTION_IDS_MAX } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  KeyLinkDown,
  KeyLinkUp,
  MATE_LINK_FRAME_MAX,
  MateLinkClosed,
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

  it.each([
    undefined,
    null,
    { turnId: "refused", provider: "Claude", resetsAt: "2026-10-10T02:00:00.123Z" },
  ])(
    "preserves absent legacy evidence, explicit recovery and typed refusal in full and partial overviews: %j",
    (refusal) => {
      const main = { ...overview.main, ...(refusal === undefined ? {} : { refusal }) };
      for (const frame of [
        { type: "overview", full: true, overview: { ...overview, main } },
        { type: "overview", full: false, sections: { main } },
      ]) {
        expect(readLinkUp(JSON.stringify(frame))).toEqual({ kind: "message", message: frame });
      }
    },
  );

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

  it("carries an engine Mate's own rows and the protocol they speak beside the shell fields", () => {
    const row = {
      conversationId: "t1",
      agent: {
        instanceId: "claudeAgent",
        driver: "claudeAgent",
        model: "claude-opus-4-6",
        profile: { kind: "mate" },
      },
      revision: { environmentId: "env-ada", epoch: 3, seq: 41 },
      state: { kind: "waiting", on: "question", words: "Which provider should it use?" },
      activeRunId: "run-2",
      latestRun: { id: "run-2", end: null, endedAt: null },
      subject: "Add a login page",
      snippet: "Which provider should it use?",
      at: 1_791_000_000_000,
      askedAt: 1_791_000_000_000,
    };
    const engine = {
      ...overview,
      identity: { ...overview.identity, engine: { protocol: 1 } },
      conversations: [row],
    };
    const whole = decodeUp(JSON.stringify({ type: "overview", full: true, overview: engine }));
    expect(whole._tag === "Success" ? whole.value : whole._tag).toEqual({
      type: "overview",
      full: true,
      overview: engine,
    });
    // A state, or a wait, a later engine adds reads as one this build does not know: no refusal.
    const later = [
      { ...row, state: { kind: "dreaming", since: 1 } },
      { ...row, state: { kind: "waiting", on: "payment", words: null } },
    ];
    expect(
      readLinkUp(
        JSON.stringify({ type: "overview", full: false, sections: { conversations: later } }),
      ),
    ).toEqual({
      kind: "message",
      message: {
        type: "overview",
        full: false,
        sections: {
          conversations: [
            { ...row, state: { kind: "unknown" } },
            { ...row, state: { kind: "waiting", on: "unknown", words: null } },
          ],
        },
      },
    });
  });

  it("reads a newer Mate's overview whose keys this build does not know as the keys it does", () => {
    const newer = {
      ...overview,
      identity: { ...overview.identity, later: { protocol: 9 } },
      laterSection: [{ id: "x" }],
    };
    expect(readLinkUp(JSON.stringify({ type: "overview", full: true, overview: newer }))).toEqual({
      kind: "message",
      message: { type: "overview", full: true, overview },
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
      ...[{ provider: "Claude", turnId: null, resetsAt: 42 }, { provider: "Claude" }].map(
        (refusal) =>
          JSON.stringify({
            type: "overview",
            full: false,
            sections: { main: { ...overview.main, refusal } },
          }),
      ),
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
        source: { environmentId: "env-1", epoch: 1, incarnation: id(0), revision: 7 },
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

describe("the keys model's link", () => {
  const decodeKeyUp = Schema.decodeUnknownExit(Schema.fromJsonString(KeyLinkUp));
  const decodeKeyDown = Schema.decodeUnknownExit(Schema.fromJsonString(KeyLinkDown));
  const self = {
    projectId: "P_MATE",
    name: "Ada",
    face: "face-1",
    standupRequestedBy: null,
    closedOff: true,
    signers: { "claude-code": "U1" },
    appId: "A1",
    appName: "Shop",
    changes: [],
    chief: { projectId: "P_CHIEF" },
  };
  const member = { userId: "U1", role: "ADMIN", visibility: "open" };

  it("a Mate opens its link with its project key and a service label, and every frame either side sends under the keys model decodes as its own type", () => {
    const up = [
      { type: "hello", key: "zcp-key", serviceId: "S_ZCP", origin: "https://mate.zerops.app" },
      {
        type: "hello",
        key: "zcp-key",
        serviceId: "S_ZCP",
        origin: "https://mate.zerops.app",
        gitFingerprint: "a".repeat(64),
      },
      { type: "pong" },
      { type: "ticket-ack", ticket: "tk-1" },
      { type: "key-refused" },
      { type: "auto-update-policy", requestId: "r1" },
    ];
    for (const frame of up)
      expect([frame.type, decodeKeyUp(JSON.stringify(frame))._tag]).toEqual([
        frame.type,
        "Success",
      ]);
    const down = [
      { type: "ping" },
      { type: "state", mate: self },
      {
        type: "state",
        mate: { ...self, chief: null, ownerUserId: "U1" },
        autoUpdate: { orgId: "O", enabled: true, revision: 1 },
      },
      { type: "access", version: 3, viewAt: AT, full: true, members: [member] },
      {
        type: "access",
        version: 4,
        viewAt: AT,
        full: false,
        members: [{ ...member, visibility: "none" }],
      },
      { type: "access", version: 5, viewAt: AT, full: false, members: [] },
      { type: "access", version: 6, full: true, refused: true, members: [] },
      { type: "ticket", ticket: "tk-1", userId: "U1", sessionId: "hs-1", expiresIn: 60 },
      { type: "close-session", sessionId: "hs-1" },
      { type: "git-credential", credential: "gc-1" },
      { type: "git-credential", credential: null },
      // Today's frames a Mate keeps: its tasks, its usage and its update policy.
      { type: "task-stop", taskId: "task-1", reason: "closed" },
      { type: "provider-keys", keys: [] },
      { type: "usage-error", batchId: "b1", code: "x", disposition: "transient" },
      {
        type: "auto-update-policy",
        requestId: "r1",
        policy: { orgId: "O", enabled: false, revision: 2 },
      },
    ];
    for (const frame of down)
      expect([frame.type, decodeKeyDown(JSON.stringify(frame))._tag]).toEqual([
        frame.type,
        "Success",
      ]);
    const refused = decodeKeyDown(JSON.stringify(down[6]));
    expect(
      refused._tag === "Success" && refused.value.type === "access" && "refused" in refused.value,
    ).toBe(true);
  });

  it("a state under the keys model brings every open change a Mate holds per branch with its review, and an older HQ's state reads without them", () => {
    const open = {
      repo: "appdev",
      number: 4,
      title: "Checkout copy",
      state: "open",
      head: "a".repeat(40),
      mergedSha: null,
      landedHead: null,
      branch: "feat-copy",
    };
    const review = {
      ready: true,
      mergeability: "conflict",
      behind: true,
      updatedAt: "2026-10-25T09:00:00.000Z",
    };
    const read = (mate: Record<string, unknown>) => {
      const decoded = decodeKeyDown(JSON.stringify({ type: "state", mate }));
      return decoded._tag === "Success" && decoded.value.type === "state"
        ? decoded.value.mate
        : undefined;
    };
    const perBranch = read({
      ...self,
      openPerBranch: true,
      changes: [
        { ...open, ...review },
        { ...open, number: 3, branch: undefined },
      ],
    });
    expect(perBranch?.openPerBranch).toBe(true);
    expect(perBranch?.changes.map(({ number, branch }) => [number, branch])).toEqual([
      [4, "feat-copy"],
      [3, undefined],
    ]);
    expect(perBranch?.changes[0]).toMatchObject(review);
    const older = read({ ...self, changes: [open] });
    expect(older?.openPerBranch).toBeUndefined();
    expect(older?.changes[0]?.ready).toBeUndefined();
    expect(older?.changes[0]?.mergeability).toBeUndefined();
    expect(read({ ...self, openPerBranch: false })).toBeUndefined();
  });

  it("a hello without its key, an access delta naming an unknown visibility, a refused access frame carrying members and a state without its Chief are no frames", () => {
    const { chief: _chief, ...withoutChief } = self;
    for (const hello of [
      { key: "", serviceId: "S", origin: "https://mate.zerops.app" },
      { key: "zcp-key", serviceId: "S" },
    ])
      expect(decodeKeyUp(JSON.stringify({ type: "hello", ...hello }))._tag).toBe("Failure");
    const down = [
      {
        type: "access",
        version: 1,
        viewAt: AT,
        full: false,
        members: [{ ...member, visibility: "hidden" }],
      },
      { type: "access", version: 1, full: true, refused: true, members: [member] },
      { type: "state", mate: withoutChief },
    ];
    for (const frame of down) expect(decodeKeyDown(JSON.stringify(frame))._tag).toBe("Failure");
  });

  it("HQ closes a link with a known code, and a key it does not admit names its refusal as the close reason", () => {
    const decodeClosed = Schema.decodeUnknownExit(MateLinkClosed);
    const known = [
      { code: 4409 },
      { code: 4408 },
      { code: 1001 },
      { code: 4401, reason: "key_refused" },
      { code: 4403, reason: "key_too_wide" },
      { code: 4403, reason: "key_not_sensitive" },
    ];
    for (const closed of known) expect(decodeClosed(closed)._tag).toBe("Success");
    for (const closed of [
      { code: 4403, reason: "nope" },
      { code: 4401, reason: "key_too_wide" },
      { code: 4000 },
    ])
      expect(decodeClosed(closed)._tag).toBe("Failure");
  });
});
