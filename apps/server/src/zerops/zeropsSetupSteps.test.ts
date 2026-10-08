import { assert, describe, it } from "@effect/vitest";

import {
  STAND_UP_MESSAGE,
  parseZcpStatus,
  procStartTime,
  sectionCall,
  setupDocument,
  standUpCommandIds,
  standUpDecision,
  standUpSigners,
  type SetupFacts,
  type SetupStep,
  type StandUpWait,
} from "./zeropsSetupSteps.ts";

const NOW = "2026-10-01T12:00:00Z";
const BOOT = "2026-10-01T11:50:00Z";

const status = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  updatedAt: "2026-10-01T11:59:00Z",
  runtimes: { state: "importing", startedAt: "2026-10-01T11:52:00Z", endedAt: "", error: "x" },
  standup: { state: "idle", phase: "development", startedAt: "", endedAt: "", services: [] },
  ...overrides,
});

const facts = (overrides: Partial<SetupFacts> = {}): SetupFacts => ({
  now: NOW,
  startedAt: BOOT,
  git: { state: "waiting" },
  status: undefined,
  requestedBy: "user-a",
  standUpWait: undefined,
  signinAt: undefined,
  record: undefined,
  standUpTurn: undefined,
  standUpProcessGone: false,
  sectionTurn: undefined,
  ...overrides,
});

/** zcp's halves as its first call leaves them: the dev halves stood, the stages queued. */
const half = (hostname: string, step: string, state: string) => ({
  hostname,
  step,
  state,
  processId: "",
  at: "",
  error: "",
});
const halvesAfterDev = [
  half("apidev", "verify", "done"),
  half("apistage", "build", "pending"),
  half("webdev", "verify", "done"),
  half("webstage", "build", "pending"),
];
const halvesStaging = [
  half("apidev", "verify", "done"),
  half("apistage", "build", "running"),
  half("webdev", "verify", "done"),
  half("webstage", "build", "pending"),
];
const halvesStood = halvesAfterDev.map((service) => ({
  ...service,
  step: "verify",
  state: "done",
}));

const stepOf = (document: ReturnType<typeof setupDocument>, id: string) =>
  document.steps.find((step) => step.id === id);

describe("parseZcpStatus", () => {
  it("reads a version-1 file and ignores what it does not know", () => {
    const parsed = parseZcpStatus({ ...status(), extra: { anything: true } });
    assert.strictEqual(parsed?.runtimes?.state, "importing");
    assert.strictEqual(parsed?.standup?.state, "idle");
  });

  const unreadable: ReadonlyArray<[string, unknown]> = [
    ["not an object", "{"],
    ["no version", { runtimes: { state: "done" } }],
    ["a version this build does not know", { version: 2, runtimes: { state: "done" } }],
  ];
  it.each(Array.from(unreadable, ([name, raw]) => ({ title: `is undefined for ${name}`, raw })))(
    "$title",
    ({ raw }) => assert.isUndefined(parseZcpStatus(raw)),
  );

  it("keeps each stand-up service's step, state and process", () => {
    const parsed = parseZcpStatus(
      status({
        standup: {
          state: "running",
          phase: "development",
          startedAt: "2026-10-01T11:58:00Z",
          endedAt: "",
          services: [
            { hostname: "api", step: "deploy", state: "running", processId: "p-1", at: NOW },
            { hostname: "web", step: "bogus", state: "running" },
          ],
        },
      }),
    );
    assert.deepStrictEqual(parsed?.standup?.services, [
      { hostname: "api", step: "deploy", state: "running", processId: "p-1", at: NOW, error: "" },
    ]);
  });

  const processes: ReadonlyArray<[string, unknown, { pid: number; start: string } | undefined]> = [
    ["its PID and start time", { pid: 4242, start: "98765" }, { pid: 4242, start: "98765" }],
    ["a PID whose start zcp could not read", { pid: 4242, start: "" }, { pid: 4242, start: "" }],
    ["none: a zcp that names no process", undefined, undefined],
    ["a PID that is no process", { pid: 0, start: "1" }, undefined],
    ["a PID that is not a number", { pid: "4242", start: "1" }, undefined],
  ];
  it.each(
    Array.from(processes, ([name, process, expected]) => ({
      title: `keeps the stand-up's process — ${name}`,
      process,
      expected,
    })),
  )("$title", ({ process, expected }) =>
    assert.deepStrictEqual(
      parseZcpStatus(status({ standup: { state: "running", process } }))?.standup?.process,
      expected,
    ),
  );

  const callStarts: ReadonlyArray<[string, Record<string, unknown>, string]> = [
    [
      "the stamp of the call now running it",
      { startedAt: "2026-10-01T10:00:00Z", callStartedAt: "2026-10-01T10:20:00Z" },
      "2026-10-01T10:20:00Z",
    ],
    ["the section's own start from a zcp that stamps none", { startedAt: NOW }, NOW],
  ];
  it.each(
    Array.from(callStarts, ([name, section, expected]) => ({
      title: `reads the call's start — ${name}`,
      section,
      expected,
    })),
  )("$title", ({ section, expected }) =>
    assert.strictEqual(
      parseZcpStatus(status({ standup: { state: "running", ...section } }))?.standup?.callStartedAt,
      expected,
    ),
  );
});

describe("sectionCall", () => {
  const SECTION = "2026-10-01T10:00:10Z";
  const sectionOf = (startedAt: string) =>
    parseZcpStatus(status({ standup: { state: "running", phase: "stage", startedAt } }));
  const call = (turnId: string, startedAt: string) => ({
    threadId: "thread-main",
    turnId,
    startedAt,
  });
  const cases: ReadonlyArray<[string, ReadonlyArray<ReturnType<typeof call>>, string | undefined]> =
    [
      ["the call that wrote it", [call("turn-1", "2026-10-01T10:00:09.500Z")], "turn-1"],
      [
        "a later call goes on with it: the carry's",
        [call("turn-1", "2026-10-01T10:00:09.500Z"), call("turn-2", "2026-10-01T10:30:00.000Z")],
        "turn-2",
      ],
      [
        "an earlier stand-up's call is not its",
        [call("turn-0", "2026-10-01T09:00:00.000Z"), call("turn-1", "2026-10-01T10:00:09.500Z")],
        "turn-1",
      ],
      ["no call of the server's wrote it", [call("turn-0", "2026-10-01T09:00:00.000Z")], undefined],
      ["no calls at all", [], undefined],
    ];
  it.each(
    Array.from(cases, ([name, calls, turnId]) => ({
      title: `finds the call whose turn the section waits on — ${name}`,
      calls,
      turnId,
    })),
  )("$title", ({ calls, turnId }) =>
    assert.strictEqual(sectionCall(sectionOf(SECTION), calls)?.turnId, turnId),
  );
  it("is none without a section", () =>
    assert.isUndefined(sectionCall(undefined, [call("turn-1", SECTION)])));
});

describe("procStartTime", () => {
  const stat = (comm: string, start: string) =>
    `4242 (${comm}) S 1 4242 4242 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 9 0 ${start} 1000 50 18446744073709551615`;
  const reads: ReadonlyArray<[string, string, string | undefined]> = [
    ["a plain command", stat("zcp", "98765"), "98765"],
    ["a command with spaces and a parenthesis", stat("zcp (mcp) x", "123"), "123"],
    ["a line cut short", "4242 (zcp) S 1 2", undefined],
    ["no command", "", undefined],
  ];
  it.each(
    Array.from(reads, ([name, line, expected]) => ({
      title: `reads /proc's start time — ${name}`,
      line,
      expected,
    })),
  )("$title", ({ line, expected }) => assert.strictEqual(procStartTime(line), expected));
});

describe("standUpSigners", () => {
  const signers = {
    "claude-code": "user-a",
    codex: "user-b",
    "claudeAgent-work": "user-a",
  };

  it("lists the agents a person signed in, never another login or person", () => {
    assert.deepStrictEqual(standUpSigners(signers, "user-a"), ["claude-code"]);
    assert.deepStrictEqual(standUpSigners(signers, "user-b"), ["codex"]);
    assert.deepStrictEqual(standUpSigners(signers, "user-c"), []);
  });
});

describe("the stand-up command", () => {
  it("carries the ask's words and the ids the client draws it by, the same after a restart", () => {
    assert.strictEqual(STAND_UP_MESSAGE, "Stand up development of the project.");
    assert.deepStrictEqual(standUpCommandIds("thread-1"), {
      commandId: "mate-standup-thread-1-1",
      messageId: "mate-standup-thread-1-1",
    });
  });
});

describe("standUpDecision", () => {
  const cases: ReadonlyArray<[string, Parameters<typeof standUpDecision>[0], string]> = [
    [
      "starts once the asker signed an agent in",
      { recorded: false, requestedBy: "user-a", signers: ["claude-code"], spoken: false },
      "start",
    ],
    [
      "waits for the asker's sign-in",
      { recorded: false, requestedBy: "user-a", signers: [], spoken: false },
      "wait",
    ],
    [
      "waits while nobody asked",
      { recorded: false, requestedBy: undefined, signers: [], spoken: false },
      "wait",
    ],
    [
      "never starts twice",
      { recorded: true, requestedBy: "user-a", signers: ["claude-code"], spoken: false },
      "done",
    ],
    [
      "a conversation already spoken in had its stand-up",
      { recorded: false, requestedBy: "user-a", signers: ["claude-code"], spoken: true },
      "spoken",
    ],
    // Mate signs people in to Claude Code and Codex only; an agent outside that sign-in which is
    // ready runs for anybody, the asker included.
    [
      "starts on an agent that needs no sign-in once it is ready",
      { recorded: false, requestedBy: "user-a", signers: [], ready: "cursor", spoken: false },
      "start",
    ],
    [
      "still waits for somebody to ask, whatever is ready",
      { recorded: false, requestedBy: undefined, signers: [], ready: "cursor", spoken: false },
      "wait",
    ],
    [
      "a conversation spoken in on a ready agent had its stand-up",
      { recorded: false, requestedBy: "user-a", signers: [], ready: "opencode", spoken: true },
      "spoken",
    ],
  ];
  it.each(Array.from(cases, ([name, input, expected]) => ({ title: name, input, expected })))(
    "$title",
    ({ input, expected }) => assert.strictEqual(standUpDecision(input).kind, expected),
  );

  it("starts on the agent the asker signed in, Claude first", () => {
    const decision = standUpDecision({
      recorded: false,
      requestedBy: "user-a",
      signers: ["codex", "claude-code"],
      spoken: false,
    });
    assert.deepStrictEqual(decision, { kind: "start", userId: "user-a", agentId: "claude-code" });
  });

  it("prefers the asker's own sign-in to an agent that needs none", () => {
    const decision = standUpDecision({
      recorded: false,
      requestedBy: "user-a",
      signers: ["codex"],
      ready: "cursor",
      spoken: false,
    });
    assert.deepStrictEqual(decision, { kind: "start", userId: "user-a", agentId: "codex" });
  });

  it("starts as the asker on the ready instance when they signed nothing in", () => {
    const decision = standUpDecision({
      recorded: false,
      requestedBy: "user-a",
      signers: [],
      ready: "cursor",
      spoken: false,
    });
    assert.deepStrictEqual(decision, { kind: "start", userId: "user-a", instanceId: "cursor" });
  });
});

describe("setupDocument", () => {
  it("is version 1 with the five steps in order, the container done since boot", () => {
    const document = setupDocument(facts());
    assert.strictEqual(document.version, 1);
    assert.strictEqual(document.at, NOW);
    assert.deepStrictEqual(
      document.steps.map((step) => step.id),
      ["container", "git", "runtimes", "signin", "standup"],
    );
    assert.deepStrictEqual(stepOf(document, "container"), {
      id: "container",
      state: "done",
      at: BOOT,
    });
  });

  it("carries no error text, names or ids", () => {
    const text = JSON.stringify(
      setupDocument(
        facts({
          status: parseZcpStatus(
            status({
              runtimes: { state: "failed", error: "secret-ish detail", services: [] },
              standup: {
                state: "failed",
                error: "boom",
                services: [{ hostname: "api", step: "build", state: "failed", error: "e" }],
              },
            }),
          ),
          record: { startedAt: NOW, ran: true },
        }),
      ),
    );
    for (const leak of ["secret-ish", "boom", "api", "user-a"]) {
      assert.notInclude(text, leak);
    }
  });

  // The Mate's Git access is its enrollment with HQ (zcp's `outcome.json`, C-7): done once
  // enrolled, waiting while zcp has said nothing, failed with zcp's reason where it said why not.
  const gitSteps: ReadonlyArray<[string, SetupFacts["git"], SetupStep]> = [
    ["enrolled", { state: "done", at: NOW }, { id: "git", state: "done", at: NOW }],
    ["pending", { state: "waiting" }, { id: "git", state: "waiting", at: "" }],
    [
      "no official HQ",
      { state: "failed", reason: "no_hq" },
      { id: "git", state: "failed", at: "", reason: "no_hq" },
    ],
    [
      "HQ refused",
      { state: "failed", reason: "refused", code: "not_a_mate" },
      { id: "git", state: "failed", at: "", reason: "refused", code: "not_a_mate" },
    ],
  ];
  it.each(Array.from(gitSteps, ([name, git, step]) => ({ title: `git: ${name}`, git, step })))(
    "$title",
    ({ git, step }) => {
      assert.deepStrictEqual(stepOf(setupDocument(facts({ git })), "git"), step);
    },
  );

  const runtimes: ReadonlyArray<[string, unknown, string, string]> = [
    ["no status file: an older zcp", undefined, "unknown", ""],
    ["nothing to import", { state: "none" }, "none", ""],
    ["pending", { state: "pending" }, "waiting", ""],
    ["importing", { state: "importing", startedAt: BOOT }, "running", BOOT],
    ["done", { state: "done", startedAt: BOOT, endedAt: NOW }, "done", NOW],
    ["failed", { state: "failed", startedAt: BOOT, endedAt: NOW }, "failed", NOW],
    ["a state this build does not know", { state: "later" }, "unknown", ""],
  ];
  it.each(
    Array.from(runtimes, ([name, section, state, at]) => ({
      title: `runtimes: ${name}`,
      section,
      state,
      at,
    })),
  )("$title", ({ section, state, at }) => {
    const parsed =
      section === undefined ? undefined : parseZcpStatus(status({ runtimes: section }));
    assert.deepStrictEqual(stepOf(setupDocument(facts({ status: parsed })), "runtimes"), {
      id: "runtimes",
      state,
      at,
    });
  });

  it("signin is done once its signer is recorded", () => {
    assert.strictEqual(stepOf(setupDocument(facts()), "signin")?.state, "waiting");
    assert.deepStrictEqual(stepOf(setupDocument(facts({ signinAt: NOW })), "signin"), {
      id: "signin",
      state: "done",
      at: NOW,
    });
  });

  const standups: ReadonlyArray<[string, Partial<SetupFacts>, string | undefined]> = [
    ["asked, not started", {}, "waiting"],
    [
      "started, zcp says nothing yet, its own turn asked",
      { record: { startedAt: NOW, ran: true }, standUpTurn: "running" },
      "running",
    ],
    [
      "claimed, its send not out yet: waiting, never a step that comes and goes",
      { record: { startedAt: NOW, ran: true, claimed: true } },
      "waiting",
    ],
    [
      "started, its own turn not found and zcp silent: nothing said, never a running of our own",
      { record: { startedAt: NOW, ran: true } },
      undefined,
    ],
    [
      "started, its own turn not found, zcp between its two calls",
      {
        record: { startedAt: NOW, ran: true },
        status: parseZcpStatus(
          status({ standup: { state: "running", phase: "stage", services: halvesAfterDev } }),
        ),
      },
      "running",
    ],
    [
      "started, zcp running it",
      {
        record: { startedAt: NOW, ran: true },
        status: parseZcpStatus(status({ standup: { state: "running" } })),
      },
      "running",
    ],
    [
      "started, zcp done",
      {
        record: { startedAt: NOW, ran: true },
        status: parseZcpStatus(status({ standup: { state: "done" } })),
      },
      "done",
    ],
    [
      "started, zcp failed",
      {
        record: { startedAt: NOW, ran: true },
        status: parseZcpStatus(status({ standup: { state: "failed" } })),
      },
      "failed",
    ],
    [
      "started, no status file, its turn ended",
      { record: { startedAt: NOW, ran: true }, standUpTurn: "done" },
      "done",
    ],
    [
      "started, no status file, its turn failed",
      { record: { startedAt: NOW, ran: true }, standUpTurn: "failed" },
      "failed",
    ],
    [
      "started, zcp running, its file not written for an hour: a quiet build still runs",
      {
        record: { startedAt: NOW, ran: true },
        status: parseZcpStatus(
          status({ updatedAt: "2026-10-01T11:00:00Z", standup: { state: "running" } }),
        ),
      },
      "running",
    ],
    [
      "started, zcp running, its MCP process gone",
      {
        record: { startedAt: NOW, ran: true },
        standUpProcessGone: true,
        status: parseZcpStatus(status({ standup: { state: "running" } })),
      },
      "failed",
    ],
    [
      "zcp says it ended: its word, whatever became of its process",
      {
        record: { startedAt: NOW, ran: true },
        standUpProcessGone: true,
        status: parseZcpStatus(status({ standup: { state: "done", services: halvesStood } })),
      },
      "done",
    ],
    [
      "its turn ended without the stage call: the stages were not built",
      {
        record: { startedAt: NOW, ran: true },
        standUpTurn: "done",
        sectionTurn: "done",
        status: parseZcpStatus(
          status({ standup: { state: "running", phase: "stage", services: halvesAfterDev } }),
        ),
      },
      "failed",
    ],
    [
      "its turn failed before the stage call: the stages were not built",
      {
        record: { startedAt: NOW, ran: true },
        standUpTurn: "failed",
        sectionTurn: "failed",
        status: parseZcpStatus(
          status({ standup: { state: "running", phase: "stage", services: halvesAfterDev } }),
        ),
      },
      "failed",
    ],
    [
      "its turn over, a later call building the stages",
      {
        record: { startedAt: NOW, ran: true },
        standUpTurn: "done",
        sectionTurn: "done",
        status: parseZcpStatus(
          status({ standup: { state: "running", phase: "stage", services: halvesStaging } }),
        ),
      },
      "running",
    ],
    [
      "its turn over, zcp in the development phase: zcp's word",
      {
        record: { startedAt: NOW, ran: true },
        standUpTurn: "done",
        sectionTurn: "done",
        status: parseZcpStatus(status({ standup: { state: "running", services: halvesStaging } })),
      },
      "running",
    ],
    [
      "a re-run in a later turn waits for its stage call: the recorded turn's end is not its",
      {
        record: { startedAt: NOW, ran: true },
        standUpTurn: "done",
        sectionTurn: "running",
        status: parseZcpStatus(
          status({ standup: { state: "running", phase: "stage", services: halvesAfterDev } }),
        ),
      },
      "running",
    ],
    [
      "nothing recorded, its turn ended without the stage call: the stages were not built",
      {
        sectionTurn: "done",
        status: parseZcpStatus(
          status({ standup: { state: "running", phase: "stage", services: halvesAfterDev } }),
        ),
      },
      "failed",
    ],
    [
      "settled as never due, zcp's own run's turn ended without the stage call",
      {
        record: { startedAt: NOW, ran: false },
        sectionTurn: "done",
        status: parseZcpStatus(
          status({ standup: { state: "running", phase: "stage", services: halvesAfterDev } }),
        ),
      },
      "failed",
    ],
    [
      "nothing recorded, no call of the section seen (an agent outside the server): running",
      {
        status: parseZcpStatus(
          status({ standup: { state: "running", phase: "stage", services: halvesAfterDev } }),
        ),
      },
      "running",
    ],
    [
      "HQ's birth names nobody who asked, its project closed off: no stand-up to run",
      { requestedBy: undefined, nobodyAsked: true },
      "none",
    ],
    ["settled with none ran: none", { record: { startedAt: NOW, ran: false } }, "none"],
    [
      "settled with none ran, then zcp ran one",
      {
        record: { startedAt: NOW, ran: false },
        status: parseZcpStatus(status({ standup: { state: "running" } })),
      },
      "running",
    ],
    [
      "started, the development half returned with the stage halves still to build",
      {
        record: { startedAt: NOW, ran: true },
        standUpTurn: "running",
        status: parseZcpStatus(status({ standup: { state: "done", services: halvesAfterDev } })),
      },
      "running",
    ],
    [
      "started, the development half returned, its own turn not read: zcp's word",
      {
        record: { startedAt: NOW, ran: true },
        status: parseZcpStatus(status({ standup: { state: "done", services: halvesAfterDev } })),
      },
      "done",
    ],
    [
      "settled as never due, then zcp stood up the development half only: zcp's word",
      {
        record: { startedAt: NOW, ran: false },
        status: parseZcpStatus(status({ standup: { state: "done", services: halvesAfterDev } })),
      },
      "done",
    ],
    [
      "zcp keeping its own section running between the two calls",
      {
        record: { startedAt: NOW, ran: true },
        standUpTurn: "running",
        status: parseZcpStatus(
          status({ standup: { state: "running", phase: "stage", services: halvesAfterDev } }),
        ),
      },
      "running",
    ],
    [
      "started, the stage half started after the development half",
      {
        record: { startedAt: NOW, ran: true },
        standUpTurn: "running",
        status: parseZcpStatus(
          status({ standup: { state: "running", phase: "stage", services: halvesStaging } }),
        ),
      },
      "running",
    ],
    [
      "started, both halves returned",
      {
        record: { startedAt: NOW, ran: true },
        standUpTurn: "running",
        status: parseZcpStatus(
          status({ standup: { state: "done", phase: "stage", services: halvesStood } }),
        ),
      },
      "done",
    ],
    [
      "started, the development half returned and its turn ended without the stage call",
      {
        record: { startedAt: NOW, ran: true },
        standUpTurn: "done",
        status: parseZcpStatus(status({ standup: { state: "done", services: halvesAfterDev } })),
      },
      "done",
    ],
  ];
  it.each(
    Array.from(standups, ([name, overrides, state]) => ({
      title: `standup: ${name}`,
      overrides,
      state,
    })),
  )("$title", ({ overrides, state }) =>
    assert.strictEqual(stepOf(setupDocument(facts(overrides)), "standup")?.state, state),
  );

  // A stand-up that ended short says why: the client words it.
  const endings: ReadonlyArray<[string, Partial<SetupFacts>, SetupStep]> = [
    [
      "its MCP process gone",
      {
        record: { startedAt: NOW, ran: true },
        standUpTurn: "running",
        standUpProcessGone: true,
        status: parseZcpStatus(
          status({ standup: { state: "running", startedAt: "2026-10-01T11:58:00Z" } }),
        ),
      },
      { id: "standup", state: "failed", at: "", reason: "process_gone" },
    ],
    [
      "its turn over without the stage call",
      {
        record: { startedAt: NOW, ran: true },
        standUpTurn: "done",
        sectionTurn: "done",
        status: parseZcpStatus(
          status({
            standup: {
              state: "running",
              phase: "stage",
              startedAt: "2026-10-01T11:58:00Z",
              services: halvesAfterDev,
            },
          }),
        ),
      },
      { id: "standup", state: "failed", at: "", reason: "stage_not_built" },
    ],
  ];
  it.each(
    Array.from(endings, ([name, overrides, step]) => ({
      title: `a stand-up that ended short says why — ${name}`,
      overrides,
      step,
    })),
  )("$title", ({ overrides, step }) =>
    assert.deepStrictEqual(stepOf(setupDocument(facts(overrides)), "standup"), step),
  );

  // A stand-up nothing started waits, and says why where the server knows: the client words it.
  const waits: ReadonlyArray<[string, StandUpWait | undefined, SetupStep]> = [
    [
      "zcp found no official HQ",
      { reason: "no_hq" },
      { id: "standup", state: "waiting", at: "", reason: "no_hq" },
    ],
    [
      "HQ refused the enrollment, with its code",
      { reason: "not_enrolled", code: "not_a_mate" },
      { id: "standup", state: "waiting", at: "", reason: "not_enrolled", code: "not_a_mate" },
    ],
    [
      "not enrolled, with nothing more said",
      { reason: "not_enrolled" },
      { id: "standup", state: "waiting", at: "", reason: "not_enrolled" },
    ],
    [
      "enrolled, HQ has not sent the Mate",
      { reason: "not_linked" },
      { id: "standup", state: "waiting", at: "", reason: "not_linked" },
    ],
    ["asked: the sign-in says the rest", undefined, { id: "standup", state: "waiting", at: "" }],
  ];
  it.each(
    Array.from(waits, ([name, wait, step]) => ({
      title: `a stand-up waiting says why — ${name}`,
      wait,
      step,
    })),
  )("$title", ({ wait, step }) =>
    assert.deepStrictEqual(stepOf(setupDocument(facts({ standUpWait: wait })), "standup"), step),
  );

  it("a stand-up under way says no reason", () =>
    assert.deepStrictEqual(
      stepOf(
        setupDocument(
          facts({
            standUpWait: { reason: "not_linked" },
            record: { startedAt: NOW, ran: true },
            standUpTurn: "running",
          }),
        ),
        "standup",
      ),
      { id: "standup", state: "running", at: NOW },
    ));
});
