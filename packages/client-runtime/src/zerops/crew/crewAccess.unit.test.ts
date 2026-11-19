import { ZeropsUserId } from "@t3tools/contracts";
import type { CrewSnapshot, ZeropsAgentAuth } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { crewAccess, crewLoginLock, type CrewLock, type CrewLoginFacts } from "./crewAccess.ts";
import { crewSnapshotFixture } from "./testing/fixtures.ts";

const JAN = ZeropsUserId.make("user-jan");
const EVA = ZeropsUserId.make("user-eva");

const agent = (fields: Partial<ZeropsAgentAuth> = {}): CrewLoginFacts["agent"] => ({
  agentId: "claude-code",
  credPresent: true,
  flagToken: false,
  ...fields,
});

const facts = (fields: Partial<CrewLoginFacts> = {}): CrewLoginFacts => ({
  agent: agent(),
  authorizedBy: { subject: JAN },
  ...fields,
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
  readsAlong = false,
) =>
  crewAccess({
    readsAlong,
    snapshot,
    lockOf: lockOn(closed),
    defaultLogin,
    reading: false,
  });

const locked = (login: string): CrewLock => ({
  login,
  agentId: "claude-code",
  ownership: "someone-else",
});

// witness: packages/client-runtime/src/zerops/crew/crewAccess.ts | if (agentOwnershipAllowsTurns(ownership)) return null; → if (!agentOwnershipAllowsTurns(ownership)) return null;
it("CA1: A crewmate's login is run only by the person who signed it in: another viewer finds it closed, with whose it is", () => {
  expect(crewLoginLock("claudeAgent", facts(), JAN)).toBeNull();
  expect(crewLoginLock("claudeAgent", facts(), EVA)).toEqual(locked("claudeAgent"));
});

// witness: packages/client-runtime/src/zerops/crew/crewAccess.ts | if (facts === undefined || facts.agent.flagToken) return null; → if (facts === undefined) return null;
it("CA2: A login on a project token is open to every viewer, whoever signed it in", () => {
  expect(
    crewLoginLock("claudeAgent", facts({ agent: agent({ flagToken: true }) }), EVA),
  ).toBeNull();
});

// witness: packages/client-runtime/src/zerops/crew/crewAccess.ts | const lockOf = input.readsAlong ? () => READS_ALONG : input.lockOf; → const lockOf = input.lockOf;
it("CA3: A viewer reading along in a colleague's Mate finds every press on its crew closed, though every login is theirs to run", () => {
  const crew = access(MIXED, [], "claudeAgent", true);
  const lock = { ownership: "reads-along" };
  expect(crew.crew).toEqual(lock);
  expect(crew.composer).toEqual(lock);
  expect(crew.crewmate("frontend")).toEqual(lock);
  expect(crew.login("claudeAgent")).toEqual(lock);
});

// witness: packages/client-runtime/src/zerops/crew/crewAccess.ts | command: (command) => reach(crewCommandReach(command)), → command: () => reach({ kind: "crew" }),
it("CA4: A press is closed when it reaches a crewmate on a login the viewer may not run, and open when every crewmate it reaches is theirs", () => {
  const crew = access(MIXED, ["claudeAgent_eva"]);
  expect(crew.command({ _tag: "message", handle: "backend", text: "x", attachments: [] })).toEqual(
    locked("claudeAgent_eva"),
  );
  expect(
    crew.command({ _tag: "message", handle: "frontend", text: "x", attachments: [] }),
  ).toBeNull();
});

// witness: packages/client-runtime/src/zerops/crew/crewAccess.ts | crewmates.some((mate) => lockOf(mate.login.id) === null) → crewmates.every((mate) => lockOf(mate.login.id) === null)
it("CA5: The composer speaks to the lead's login; with no lead it stays open while any crewmate may be picked and closes once none may", () => {
  expect(access(MIXED, ["claudeAgent_eva"]).composer).toBeNull();
  expect(access(MIXED, ["claudeAgent"]).composer).toEqual(locked("claudeAgent"));
  expect(access(LEADLESS, ["claudeAgent"]).composer).toBeNull();
  expect(access(LEADLESS, ["claudeAgent", "claudeAgent_eva", "codex"]).composer).toEqual(
    locked("claudeAgent_eva"),
  );
});

// witness: packages/client-runtime/src/zerops/crew/crewAccess.ts | const crew = crewmates.length === 0 ? lockOf(input.defaultLogin) : reach({ kind: "crew" }); → const crew = reach({ kind: "crew" });
it("CA6: A crew nobody set up yet is closed on the login it would run on, the project's default, and open where that login is the viewer's", () => {
  const none = crewSnapshotFixture({ status: "none", crewmates: [], board: { tasks: [] } });
  expect([
    access(none, ["claudeAgent"]).crew,
    access(none, ["claudeAgent"]).composer,
    access(none, ["claudeAgent"], "codex").crew,
  ]).toEqual([locked("claudeAgent"), locked("claudeAgent"), null]);
});

// witness: packages/client-runtime/src/zerops/crew/crewAccess.ts | login: member.login ?? input.defaultLogin, → login: member.login ?? member.handle,
it("CA7: Apply of a crew home is closed on any login the home names, a crewmate naming none counted on the project's default login", () => {
  const none = crewSnapshotFixture({ status: "none", crewmates: [], board: { tasks: [] } });
  const home = [{ handle: "lead" }, { handle: "backend", login: "claudeAgent_eva" }];
  expect([
    access(none, ["claudeAgent_eva"]).home(home),
    access(none, ["claudeAgent"], "codex").home(home),
    access(none, ["claudeAgent"]).home(home),
  ]).toEqual([locked("claudeAgent_eva"), null, locked("claudeAgent")]);
});
