import { describe, expect, it } from "vite-plus/test";
import type { ZeropsAgentAuthSnapshot } from "@t3tools/contracts";

import {
  resolveZeropsAgentAvailability,
  zeropsAgentAuthReads,
  zeropsAgentAvailabilityIsRunnable,
  type ZeropsAgentAuthFacts,
  type ZeropsAgentAuthRead,
  type ZeropsAgentAvailability,
} from "./agentAvailability.ts";
import type { FailureReason, Freshness, Known } from "./knowledge/index.ts";

const JAN = "jan-user-id";
const EVA = "eva-user-id";

const signedIn = {
  state: "authorized",
  providerAuth: "authenticated",
  credPresent: true,
  flagToken: false,
} as const;
const tokenAgent = {
  state: "authorized-token",
  providerAuth: "unknown",
  credPresent: false,
  flagToken: true,
} as const;

type AgentRow = Pick<ZeropsAgentAuthFacts, "state" | "providerAuth" | "credPresent" | "flagToken">;

/** The agent's row as the feed delivers it: complete, and live unless said otherwise. */
const known = (
  facts: ZeropsAgentAuthFacts,
  freshness: Freshness = { kind: "live" },
): ZeropsAgentAuthRead => ({
  state: "known",
  value: facts,
  asOf: { ordinal: 1, atMs: 1_000 },
  coverage: "complete",
  freshness,
});

function input(agent: AgentRow, signer: string | undefined, subject: string | undefined) {
  return {
    agent: known({
      ...agent,
      authorizedBy: signer === undefined ? undefined : { subject: signer },
    }),
    viewerSubject: subject,
  };
}

// Mirrors apps/server/src/zerops/ZeropsProjectSigners.test.ts's `turnRefusal`
// table row for row (turnRefusal's `undefined`/refusal kind mapped onto this
// module's richer client answer) — see agentAvailability.ts's module doc for
// why the "unidentified viewer" row disagrees with `resolveAgentOwnership`.
describe("resolveZeropsAgentAvailability — agrees with turnRefusal", () => {
  it.each([
    ["my own agent", signedIn, JAN, JAN, { kind: "ready" }],
    [
      "an agent somebody else signed in",
      signedIn,
      EVA,
      JAN,
      { kind: "someone-else", signerId: EVA },
    ],
    [
      "an agent nobody's sign-in was recorded for",
      signedIn,
      undefined,
      JAN,
      { kind: "unrecorded" },
    ],
    ["an agent whose recorded signer is blank", signedIn, "", JAN, { kind: "unrecorded" }],
    [
      "a caller the session could not name",
      signedIn,
      JAN,
      undefined,
      { kind: "someone-else", signerId: JAN },
    ],
    ["a token-authorized agent somebody else signed in", tokenAgent, EVA, JAN, { kind: "ready" }],
    [
      "a token-authorized agent with no record at all",
      tokenAgent,
      undefined,
      JAN,
      { kind: "ready" },
    ],
    // turnRefusal classifies FIRST: a token agent whose own CLI probe says
    // unauthenticated is refused as not-signed-in before flagToken is ever
    // consulted — the token bypasses ownership, never the sign-in check itself.
    [
      "a token-authorized agent whose own check says its login no longer works",
      { ...tokenAgent, providerAuth: "unauthenticated" },
      JAN,
      JAN,
      { kind: "needs-sign-in", signInKind: "needs-reauth" },
    ],
    [
      "my agent still being registered",
      { ...signedIn, state: "local-only" },
      JAN,
      JAN,
      { kind: "registering" },
    ],
    [
      "an agent nobody signed in",
      {
        state: "not-authorized",
        providerAuth: "unauthenticated",
        credPresent: false,
        flagToken: false,
      },
      undefined,
      JAN,
      { kind: "needs-sign-in", signInKind: "not-authorized" },
    ],
    [
      "an agent the project signed in but this container has no login for",
      { ...signedIn, credPresent: false, state: "reconnect" },
      JAN,
      JAN,
      { kind: "needs-sign-in", signInKind: "reconnect" },
    ],
    [
      "an agent whose own check says its login no longer works",
      { ...signedIn, providerAuth: "unauthenticated" },
      JAN,
      JAN,
      { kind: "needs-sign-in", signInKind: "needs-reauth" },
    ],
  ] satisfies ReadonlyArray<
    [string, AgentRow, string | undefined, string | undefined, ZeropsAgentAvailability]
  >)("%s", (_name, agent, signer, subject, expected) => {
    expect(resolveZeropsAgentAvailability(input(agent, signer, subject))).toEqual(expected);
  });
});

describe("resolveZeropsAgentAvailability — client-only states", () => {
  it("a login session in progress is signing-in even over a stale not-authorized state", () => {
    expect(
      resolveZeropsAgentAvailability({
        agent: known({
          state: "not-authorized",
          providerAuth: "unknown",
          credPresent: false,
          flagToken: false,
          loginPhase: "awaiting-browser",
        }),
        viewerSubject: JAN,
      }),
    ).toEqual({ kind: "signing-in" });
  });

  it("a token-authorized agent is ready even mid-login (token wins over an in-progress session)", () => {
    expect(
      resolveZeropsAgentAvailability({
        agent: known({
          ...tokenAgent,
          loginPhase: "awaiting-code",
        }),
        viewerSubject: JAN,
      }),
    ).toEqual({ kind: "ready" });
  });

  it("a cancelled login session falls back to the baseline classification", () => {
    expect(
      resolveZeropsAgentAvailability({
        agent: known({
          state: "not-authorized",
          providerAuth: "unknown",
          credPresent: false,
          flagToken: false,
          loginPhase: "cancelled",
        }),
        viewerSubject: JAN,
      }),
    ).toEqual({ kind: "needs-sign-in", signInKind: "not-authorized" });
  });

  it("recordFailed never overrides an authorizedBy tag the server already reads (naming the viewer)", () => {
    expect(
      resolveZeropsAgentAvailability({
        agent: known({
          ...signedIn,
          authorizedBy: { subject: JAN },
        }),
        viewerSubject: JAN,
        recordFailed: true,
      }),
    ).toEqual({ kind: "ready" });
  });

  it("recordFailed never overrides an authorizedBy tag naming someone else", () => {
    expect(
      resolveZeropsAgentAvailability({
        agent: known({
          ...signedIn,
          authorizedBy: { subject: EVA },
        }),
        viewerSubject: JAN,
        recordFailed: true,
      }),
    ).toEqual({ kind: "someone-else", signerId: EVA });
  });

  it("recordFailed with nothing recorded at all is still unrecorded", () => {
    expect(
      resolveZeropsAgentAvailability({
        agent: known({
          ...signedIn,
          authorizedBy: undefined,
        }),
        viewerSubject: JAN,
        recordFailed: true,
      }),
    ).toEqual({ kind: "unrecorded" });
  });

  it("a login in progress does not override an agent this viewer can already run (5a)", () => {
    expect(
      resolveZeropsAgentAvailability({
        agent: known({
          ...signedIn,
          authorizedBy: { subject: JAN },
          loginPhase: "awaiting-browser",
        }),
        viewerSubject: JAN,
      }),
    ).toEqual({ kind: "ready" });
  });

  it("a login in progress still overrides an agent this viewer cannot otherwise run", () => {
    expect(
      resolveZeropsAgentAvailability({
        agent: known({
          ...signedIn,
          authorizedBy: { subject: EVA },
          loginPhase: "awaiting-browser",
        }),
        viewerSubject: JAN,
      }),
    ).toEqual({ kind: "signing-in" });
  });
});

const TIMEOUT: FailureReason = { kind: "timeout", afterMs: 15_000 };
const UNSUPPORTED: FailureReason = { kind: "unsupported", capability: "subscribeZeropsAgentAuth" };

describe("resolveZeropsAgentAvailability — agent auth not known yet", () => {
  it.each([
    ["unread", { state: "unread", waitingFor: null }],
    ["waiting for the Mate", { state: "unread", waitingFor: "mate-session" }],
    ["reading", { state: "reading", sinceMs: 1_000, attempt: 1 }],
    ["failed", { state: "failed", failure: TIMEOUT, atMs: 2_000, attempt: 1, retryAtMs: null }],
    [
      "failed on an old Mate",
      { state: "failed", failure: UNSUPPORTED, atMs: 2_000, attempt: 1, retryAtMs: null },
    ],
  ] satisfies ReadonlyArray<[string, ZeropsAgentAuthRead]>)(
    "unread agent auth never reads needs-sign-in: %s",
    (_name, agent) => {
      for (const viewerSubject of [JAN, undefined]) {
        for (const recordFailed of [false, true]) {
          const availability = resolveZeropsAgentAvailability({
            agent,
            viewerSubject,
            recordFailed,
          });
          expect(availability).toEqual({ kind: "unknown", read: agent });
        }
      }
    },
  );

  it("a failed read keeps its cause for the copy", () => {
    const agent: ZeropsAgentAuthRead = {
      state: "failed",
      failure: TIMEOUT,
      atMs: 2_000,
      attempt: 1,
      retryAtMs: null,
    };
    const availability = resolveZeropsAgentAvailability({ agent, viewerSubject: JAN });
    expect(availability.kind === "unknown" && availability.read).toMatchObject({
      state: "failed",
      failure: TIMEOUT,
    });
  });

  it("a stale known row still answers from its kept value", () => {
    const agent = known(
      { ...signedIn, authorizedBy: { subject: JAN } },
      { kind: "stale", reason: { kind: "source-recovering", retryAtMs: null }, sinceMs: 3_000 },
    );
    expect(resolveZeropsAgentAvailability({ agent, viewerSubject: JAN })).toEqual({
      kind: "ready",
    });
  });
});

describe("zeropsAgentAvailabilityIsRunnable", () => {
  it.each([
    [{ kind: "ready" }, true],
    [{ kind: "registering" }, true],
    [{ kind: "signing-in" }, false],
    [{ kind: "needs-sign-in", signInKind: "not-authorized" }, false],
    [{ kind: "someone-else", signerId: undefined }, false],
    [{ kind: "unrecorded" }, false],
    [{ kind: "unknown", read: { state: "reading", sinceMs: 1_000, attempt: 1 } }, false],
  ] satisfies ReadonlyArray<[ZeropsAgentAvailability, boolean]>)(
    "%o → %s",
    (availability, expected) => {
      expect(zeropsAgentAvailabilityIsRunnable(availability)).toBe(expected);
    },
  );
});

describe("zeropsAgentAuthReads", () => {
  const SNAPSHOT: ZeropsAgentAuthSnapshot = {
    available: true,
    agents: [{ agentId: "codex", flagOAuth: true, ...signedIn }],
  };
  const facts = (row: ZeropsAgentAuthSnapshot["agents"][number]): ZeropsAgentAuthFacts => ({
    state: row.state,
    providerAuth: row.providerAuth,
    credPresent: row.credPresent,
    flagToken: row.flagToken,
    authorizedBy: { subject: JAN },
  });
  const knownSnapshot = (snapshot: ZeropsAgentAuthSnapshot): Known<ZeropsAgentAuthSnapshot> => ({
    state: "known",
    value: snapshot,
    asOf: { ordinal: 1, atMs: 1_000 },
    coverage: "complete",
    freshness: { kind: "live" },
  });

  it("an unread snapshot is every agent's read, never a snapshot without agents", () => {
    const read: Known<ZeropsAgentAuthSnapshot> = { state: "reading", sinceMs: 0, attempt: 1 };
    const reads = zeropsAgentAuthReads(read, facts);
    expect(reads?.("codex")).toEqual(read);
    expect(reads?.("claude-code")).toEqual(read);
  });

  it("a known snapshot answers with each agent's own row, and nothing for one it does not carry", () => {
    const reads = zeropsAgentAuthReads(knownSnapshot(SNAPSHOT), facts);
    expect(reads?.("codex")).toEqual(known(facts(SNAPSHOT.agents[0]!)));
    expect(reads?.("claude-code")).toBeUndefined();
  });

  it.each<{ readonly name: string; readonly read: Known<ZeropsAgentAuthSnapshot> }>([
    { name: "a Mate outside Zerops", read: knownSnapshot({ available: false, agents: [] }) },
    {
      name: "a failed read",
      read: {
        state: "failed",
        failure: { kind: "unsupported", capability: "subscribeZeropsAgentAuth" },
        atMs: 0,
        attempt: 1,
        retryAtMs: null,
      },
    },
  ])("nothing gates the agents on $name", ({ read }) => {
    expect(zeropsAgentAuthReads(read, facts)).toBeUndefined();
  });
});
