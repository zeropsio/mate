import { assert, describe, it } from "@effect/vitest";

import {
  STAND_UP_MESSAGE,
  hasGitVariables,
  isStandUpCommand,
  parseZcpStatus,
  setupDocument,
  standUpCommandIds,
  standUpDecision,
  standUpRequestedBy,
  standUpSigners,
  type SetupFacts,
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
  gitAt: undefined,
  status: undefined,
  tagsRead: true,
  requestedBy: "user-a",
  signinAt: undefined,
  record: undefined,
  standUpTurn: undefined,
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
  for (const [name, raw] of unreadable) {
    it(`is undefined for ${name}`, () => assert.isUndefined(parseZcpStatus(raw)));
  }

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
});

describe("standUpRequestedBy and standUpSigners", () => {
  const tags = [
    "mate:face:coral:gem",
    "mate:standup:user-a",
    "mate:signer:claude-code:user-a",
    "mate:signer:codex:user-b",
    "mate:signer:login-7:user-a",
  ];

  it("names who asked for the stand-up", () => {
    assert.strictEqual(standUpRequestedBy(tags), "user-a");
    assert.isUndefined(standUpRequestedBy(["mate:standup:"]));
    assert.isUndefined(standUpRequestedBy([]));
  });

  it("lists the agents a person signed in, never another login or person", () => {
    assert.deepStrictEqual(standUpSigners(tags, "user-a"), ["claude-code"]);
    assert.deepStrictEqual(standUpSigners(tags, "user-b"), ["codex"]);
    assert.deepStrictEqual(standUpSigners(tags, "user-c"), []);
  });

  it("an agent recorded for two people is nobody's", () => {
    const both = ["mate:signer:claude-code:user-a", "mate:signer:claude-code:user-b"];
    assert.deepStrictEqual(standUpSigners(both, "user-a"), []);
  });
});

describe("the stand-up command", () => {
  it("carries the browser's words and ids, so the two never run twice", () => {
    assert.strictEqual(STAND_UP_MESSAGE, "Stand up development of the project.");
    assert.deepStrictEqual(standUpCommandIds("thread-1"), {
      commandId: "mate-standup-thread-1-1",
      messageId: "mate-standup-thread-1-1",
    });
  });

  const commands: ReadonlyArray<[string, unknown, boolean]> = [
    ["a browser's stand-up", { type: "thread.turn.start", commandId: "mate-standup-t-2" }, true],
    ["any other turn", { type: "thread.turn.start", commandId: "c-1" }, false],
    ["another command", { type: "thread.create", commandId: "mate-standup-t-1" }, false],
  ];
  for (const [name, command, expected] of commands) {
    it(`${name} is ${expected ? "" : "not "}a stand-up`, () =>
      assert.strictEqual(isStandUpCommand(command as never), expected));
  }
});

describe("hasGitVariables", () => {
  it("needs all three of the broker's variables", () => {
    assert.isTrue(hasGitVariables(["A", "GITEA_URL", "GITEA_TOKEN", "MATE_BROKER_URL"]));
    assert.isFalse(hasGitVariables(["GITEA_URL", "GITEA_TOKEN"]));
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
  for (const [name, input, expected] of cases) {
    it(name, () => assert.strictEqual(standUpDecision(input).kind, expected));
  }

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

  it("git waits until the broker's variables arrive", () => {
    assert.deepStrictEqual(stepOf(setupDocument(facts()), "git"), {
      id: "git",
      state: "waiting",
      at: "",
    });
    assert.deepStrictEqual(stepOf(setupDocument(facts({ gitAt: NOW })), "git"), {
      id: "git",
      state: "done",
      at: NOW,
    });
  });

  const runtimes: ReadonlyArray<[string, unknown, string, string]> = [
    ["no status file: an older zcp", undefined, "unknown", ""],
    ["nothing to import", { state: "none" }, "none", ""],
    ["pending", { state: "pending" }, "waiting", ""],
    ["importing", { state: "importing", startedAt: BOOT }, "running", BOOT],
    ["done", { state: "done", startedAt: BOOT, endedAt: NOW }, "done", NOW],
    ["failed", { state: "failed", startedAt: BOOT, endedAt: NOW }, "failed", NOW],
    ["a state this build does not know", { state: "later" }, "unknown", ""],
  ];
  for (const [name, section, state, at] of runtimes) {
    it(`runtimes: ${name}`, () => {
      const parsed =
        section === undefined ? undefined : parseZcpStatus(status({ runtimes: section }));
      assert.deepStrictEqual(stepOf(setupDocument(facts({ status: parsed })), "runtimes"), {
        id: "runtimes",
        state,
        at,
      });
    });
  }

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
    ["nothing asked, nothing started: no stand-up to run", { requestedBy: undefined }, "none"],
    [
      "started, zcp says running but stopped refreshing its file: its MCP server died",
      {
        record: { startedAt: NOW, ran: true },
        status: parseZcpStatus(
          status({ updatedAt: "2026-10-01T11:57:59Z", standup: { state: "running" } }),
        ),
      },
      "failed",
    ],
    [
      "started, zcp running and refreshed two minutes ago: still running",
      {
        record: { startedAt: NOW, ran: true },
        status: parseZcpStatus(
          status({ updatedAt: "2026-10-01T11:58:00Z", standup: { state: "running" } }),
        ),
      },
      "running",
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
    [
      "the tags not read yet: it may yet be asked",
      { requestedBy: undefined, tagsRead: false },
      "waiting",
    ],
  ];
  for (const [name, overrides, state] of standups) {
    it(`standup: ${name}`, () =>
      assert.strictEqual(stepOf(setupDocument(facts(overrides)), "standup")?.state, state));
  }
});
