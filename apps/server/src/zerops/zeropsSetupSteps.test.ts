import { assert, describe, it } from "@effect/vitest";

import {
  STAND_UP_MESSAGE,
  hasGitVariables,
  parseZcpStatus,
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
  gitAt: undefined,
  status: undefined,
  requestedBy: "user-a",
  standUpWait: undefined,
  signinAt: undefined,
  record: undefined,
  standUpTurn: undefined,
  ...overrides,
});

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

  const standups: ReadonlyArray<[string, Partial<SetupFacts>, string]> = [
    ["asked, not started", {}, "waiting"],
    ["started, zcp says nothing yet", { record: { startedAt: NOW, ran: true } }, "running"],
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
    ["settled with none ran: done", { record: { startedAt: NOW, ran: false } }, "done"],
  ];
  for (const [name, overrides, state] of standups) {
    it(`standup: ${name}`, () =>
      assert.strictEqual(stepOf(setupDocument(facts(overrides)), "standup")?.state, state));
  }

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
    [
      "HQ names nobody who asked",
      { reason: "awaiting_request" },
      { id: "standup", state: "waiting", at: "", reason: "awaiting_request" },
    ],
    ["asked: the sign-in says the rest", undefined, { id: "standup", state: "waiting", at: "" }],
  ];
  for (const [name, wait, step] of waits) {
    it(`a stand-up waiting says why — ${name}`, () =>
      assert.deepStrictEqual(stepOf(setupDocument(facts({ standUpWait: wait })), "standup"), step));
  }

  it("a stand-up under way says no reason", () =>
    assert.deepStrictEqual(
      stepOf(
        setupDocument(
          facts({ standUpWait: { reason: "not_linked" }, record: { startedAt: NOW, ran: true } }),
        ),
        "standup",
      ),
      { id: "standup", state: "running", at: NOW },
    ));
});
