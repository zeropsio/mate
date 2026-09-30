import type { CrewCommand, CrewSnapshot, ZeropsAgentAuth } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { crewAccess, crewLoginLock, type CrewLock, type CrewLoginFacts } from "./crewAccess.ts";
import { crewSnapshotFixture } from "./testing/fixtures.ts";

const JAN = "user-jan";
const EVA = "user-eva";

const agent = (fields: Partial<ZeropsAgentAuth> = {}): CrewLoginFacts["agent"] => ({
  agentId: "claude-code",
  credPresent: true,
  flagToken: false,
  ...fields,
});

const facts = (fields: Partial<CrewLoginFacts> = {}): CrewLoginFacts => ({
  agent: agent(),
  authorizedBy: { subject: JAN },
  recordFailed: false,
  ...fields,
});

describe("crewLoginLock — a login read as its conversation reads it", () => {
  it.each([
    ["open to its signer", facts(), JAN, null],
    [
      "closed to anybody else",
      facts(),
      EVA,
      { login: "claudeAgent", agentId: "claude-code", ownership: "someone-else" },
    ],
    [
      "closed to everybody while nobody's sign-in is on record",
      facts({ authorizedBy: undefined }),
      JAN,
      { login: "claudeAgent", agentId: "claude-code", ownership: "unrecorded" },
    ],
    [
      "closed while this browser's own record failed",
      facts({ authorizedBy: undefined, recordFailed: true }),
      JAN,
      { login: "claudeAgent", agentId: "claude-code", ownership: "record-failed" },
    ],
    [
      "closed to a viewer nobody can name",
      facts(),
      undefined,
      { login: "claudeAgent", agentId: "claude-code", ownership: "unrecorded" },
    ],
    ["open to anybody on a project token", facts({ agent: agent({ flagToken: true }) }), EVA, null],
    [
      "open to anybody where no credential is held: nobody's to spend",
      facts({ agent: agent({ credPresent: false }) }),
      EVA,
      null,
    ],
    ["open on a login Mate signs nobody in to", undefined, EVA, null],
  ] as const satisfies ReadonlyArray<
    readonly [string, CrewLoginFacts | undefined, string | undefined, CrewLock | null]
  >)("%s", (_name, loginFacts, viewer, lock) => {
    expect(crewLoginLock("claudeAgent", loginFacts, viewer)).toEqual(lock);
  });
});

const lockOn =
  (closed: ReadonlyArray<string>) =>
  (login: string): CrewLock | null =>
    closed.includes(login) ? { login, agentId: "claude-code", ownership: "someone-else" } : null;

/** The fixture's crew with Backend on Eva's second login: the lead and Frontend on the default, Erik on Codex. */
const MIXED: CrewSnapshot = (() => {
  const crew = crewSnapshotFixture();
  return {
    ...crew,
    crewmates: crew.crewmates.map((mate) =>
      mate.handle === "backend"
        ? { ...mate, login: { id: "claudeAgent_eva", label: "eva", agent: "claude-code" } }
        : mate,
    ),
  };
})();

const LEADLESS: CrewSnapshot = {
  ...MIXED,
  crewmates: MIXED.crewmates.filter((mate) => mate.kind !== "lead"),
};

const access = (
  snapshot: CrewSnapshot | null,
  closed: ReadonlyArray<string>,
  defaultLogin = "claudeAgent",
) => crewAccess({ snapshot, lockOf: lockOn(closed), defaultLogin, reading: false });

const locked = (login: string): CrewLock => ({
  login,
  agentId: "claude-code",
  ownership: "someone-else",
});

describe("crewAccess — the crew exactly as closed as its conversations", () => {
  it.each([
    [
      "a message to Backend",
      { _tag: "message", handle: "backend", text: "x", attachments: [] },
      ["claudeAgent_eva"],
      locked("claudeAgent_eva"),
    ],
    [
      "a message to Frontend",
      { _tag: "message", handle: "frontend", text: "x", attachments: [] },
      ["claudeAgent_eva"],
      null,
    ],
    [
      "Backend's task",
      { _tag: "discard", taskId: "task-12" },
      ["claudeAgent_eva"],
      locked("claudeAgent_eva"),
    ],
    ["Frontend's task", { _tag: "askFix", taskId: "task-13" }, ["claudeAgent_eva"], null],
    [
      "the claim Backend asked for",
      { _tag: "claimGrant", host: "appdev" },
      ["claudeAgent_eva"],
      locked("claudeAgent_eva"),
    ],
    [
      "telling the crew goes to the lead",
      { _tag: "tell", text: "x", mentions: [] },
      ["claudeAgent_eva"],
      null,
    ],
    [
      "telling a lead on a closed login",
      { _tag: "tell", text: "x", mentions: [] },
      ["claudeAgent"],
      locked("claudeAgent"),
    ],
    [
      "a run going on reaches everybody",
      { _tag: "resume", runId: "run-3" },
      ["claudeAgent_eva"],
      locked("claudeAgent_eva"),
    ],
    [
      "a run's finish reaches everybody",
      { _tag: "finish", runId: "run-3" },
      ["claudeAgent_eva"],
      locked("claudeAgent_eva"),
    ],
    [
      "stopping a run is every member's",
      { _tag: "stop", runId: "run-3" },
      ["claudeAgent", "claudeAgent_eva", "codex"],
      null,
    ],
    [
      "pausing a run is every member's",
      { _tag: "pause", runId: "run-3" },
      ["claudeAgent", "claudeAgent_eva", "codex"],
      null,
    ],
    [
      "the goal reaches everybody",
      { _tag: "briefSave", apply: "nextTurn" },
      ["claudeAgent_eva"],
      locked("claudeAgent_eva"),
    ],
    ["a draft only reads", { _tag: "deliverDraft" }, ["claudeAgent", "claudeAgent_eva"], null],
  ] as const satisfies ReadonlyArray<
    readonly [string, CrewCommand, ReadonlyArray<string>, CrewLock | null]
  >)("%s", (_name, command, closed, lock) => {
    expect(access(MIXED, closed).command(command)).toEqual(lock);
  });

  it("closes a crewmate on its own login, and the crew on any of them", () => {
    const mixed = access(MIXED, ["claudeAgent_eva"]);
    expect([mixed.crewmate("backend"), mixed.crewmate("frontend"), mixed.crew]).toEqual([
      locked("claudeAgent_eva"),
      null,
      locked("claudeAgent_eva"),
    ]);
  });

  it.each([
    ["open to the lead's own", MIXED, ["claudeAgent_eva"], null],
    ["closed with the lead's login", MIXED, ["claudeAgent"], locked("claudeAgent")],
    ["open while one crewmate may be picked", LEADLESS, ["claudeAgent"], null],
    ["open while Erik on Codex may be picked", LEADLESS, ["claudeAgent", "claudeAgent_eva"], null],
    [
      "closed when nobody may be picked",
      LEADLESS,
      ["claudeAgent", "claudeAgent_eva", "codex"],
      locked("claudeAgent_eva"),
    ],
  ] as const satisfies ReadonlyArray<
    readonly [string, CrewSnapshot, ReadonlyArray<string>, CrewLock | null]
  >)("the composer is %s", (_name, snapshot, closed, lock) => {
    expect(access(snapshot, closed).composer).toEqual(lock);
  });

  it("closes a crew nobody set up yet on the login it would run on", () => {
    const none = crewSnapshotFixture({ status: "none", crewmates: [], board: { tasks: [] } });
    expect([
      access(none, ["claudeAgent"]).crew,
      access(none, ["claudeAgent"]).composer,
      access(none, ["claudeAgent"], "codex").crew,
    ]).toEqual([locked("claudeAgent"), locked("claudeAgent"), null]);
  });

  it("closes Apply on any login the crew home names, a crewmate naming none on the default", () => {
    const none = crewSnapshotFixture({ status: "none", crewmates: [], board: { tasks: [] } });
    const home = [{ handle: "lead" }, { handle: "backend", login: "claudeAgent_eva" }];
    expect([
      access(none, ["claudeAgent_eva"]).home(home),
      access(none, ["claudeAgent"], "codex").home(home),
      access(none, ["claudeAgent"]).home(home),
      access(none, ["claudeAgent"]).home([{ handle: "solo", login: "codex" }]),
      access(MIXED, ["claudeAgent_eva"]).home([{ handle: "solo", login: "codex" }]),
      access(none, []).home(home),
    ]).toEqual([
      locked("claudeAgent_eva"),
      null,
      locked("claudeAgent"),
      null,
      locked("claudeAgent_eva"),
      null,
    ]);
  });

  it("offers everything to the person who runs every login", () => {
    const open = access(MIXED, []);
    expect([open.crew, open.composer, open.crewmate("backend"), open.login("claudeAgent")]).toEqual(
      [null, null, null, null],
    );
  });
});
