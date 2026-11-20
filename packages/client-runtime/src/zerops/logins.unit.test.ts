import { ZeropsUserId } from "@t3tools/contracts";
import type { ZeropsAgentAuthSnapshot, ZeropsLogin } from "@t3tools/contracts";
import { classifyZeropsAgentAuth } from "@t3tools/shared/zeropsAgentAuth";
import { expect, it } from "vite-plus/test";

import { crewSnapshotFixture } from "./crew/testing/fixtures.ts";
import {
  mateLoginAsAgentRow,
  mateLoginChoices,
  mateLoginRows,
  resolveSpentLogin,
} from "./logins.ts";

const EVA = ZeropsUserId.make("u-eva");
const JAN = ZeropsUserId.make("u-jan");

const login = (patch: Partial<ZeropsLogin> & Pick<ZeropsLogin, "id">): ZeropsLogin => ({
  agent: "claude-code",
  label: "",
  kind: "subscription",
  default: false,
  state: "authorized",
  token: false,
  ...patch,
});

const snapshot = (logins: ReadonlyArray<ZeropsLogin> | undefined): ZeropsAgentAuthSnapshot => ({
  available: true,
  agents: [],
  ...(logins === undefined ? {} : { logins }),
});

// witness: packages/client-runtime/src/zerops/logins.ts | (crewmate) => crewmate.login.id === login.id → (crewmate) => crewmate.login.id !== login.id
it("ZV79: A Mate's logins are those its feed lists, each with the crewmates that run on it in roster order and its lead named where the lead is one of them; a feed that lists none, or no feed, lists nothing", () => {
  const base = crewSnapshotFixture();
  const [first, second] = base.crewmates;
  const crew = {
    crewmates: [
      {
        ...first!,
        handle: "backend",
        displayName: "Backend",
        kind: "writer",
        login: { id: "claudeAgent", label: "", agent: "claude-code" },
      },
      {
        ...second!,
        handle: "frontend",
        displayName: "Frontend",
        login: { id: "claudeAgent-work", label: "work", agent: "claude-code" },
      },
    ],
  } as const;

  const rows = mateLoginRows(
    snapshot([
      login({ id: "claudeAgent", default: true, signedInBy: EVA }),
      login({ id: "claudeAgent-work", label: "work", signedInBy: EVA }),
      login({ id: "codex", agent: "codex", default: true, state: "not-authorized" }),
    ]),
    crew,
  );

  expect(rows.map((row) => [row.id, row.crewmates, row.lead])).toEqual([
    ["claudeAgent", ["Backend"], null],
    ["claudeAgent-work", ["Frontend"], null],
    ["codex", [], null],
  ]);

  const defaultRows = mateLoginRows(
    snapshot([login({ id: "claudeAgent", default: true, signedInBy: EVA })]),
    base,
  );
  expect(defaultRows.map((row) => [row.crewmates, row.lead])).toEqual([
    [["Lead", "Backend", "Frontend"], "Lead"],
  ]);

  expect(mateLoginRows(snapshot(undefined), null)).toEqual([]);
  expect(mateLoginRows(null, null)).toEqual([]);
});

// witness: packages/client-runtime/src/zerops/logins.ts | return login.signedInBy === viewerId → return login.signedInBy !== viewerId
it("ZV80: A person's crew may run on a login they signed in themselves, authorized or still registering; a login somebody else signed in, or one whose sign-in nobody recorded, is not theirs to run", () => {
  for (const [row, usable] of [
    [login({ id: "claudeAgent-mine", signedInBy: EVA }), true],
    [login({ id: "claudeAgent-mine", signedInBy: EVA, state: "registering" }), true],
    [login({ id: "claudeAgent-cleo", signedInBy: JAN }), false],
    [login({ id: "claudeAgent-y" }), false],
  ] as const) {
    const [choice] = mateLoginChoices(mateLoginRows(snapshot([row]), null), EVA);
    expect(choice?.use.usable).toBe(usable);
  }
});

// witness: packages/client-runtime/src/zerops/logins.ts | if (login.token) return { usable: true }; → if (false) return { usable: true };
it("ZV81: A login a project token authorizes may be run by any member's crew, though no sign-in is recorded on it", () => {
  const row = login({ id: "codex", agent: "codex", default: true, token: true });
  const [choice] = mateLoginChoices(mateLoginRows(snapshot([row]), null), EVA);
  expect(choice?.use.usable).toBe(true);
});

// witness: packages/client-runtime/src/zerops/logins.ts | if (login.state !== "authorized" && login.state !== "registering") { → if (false) {
it("ZV82: A login that is not signed in, or must be signed in again, may be run by nobody's crew, its own signer's included", () => {
  for (const row of [
    login({ id: "codex-home", agent: "codex", label: "home", state: "not-authorized" }),
    login({ id: "claudeAgent-mine", signedInBy: EVA, state: "needs-reauth" }),
    login({ id: "claudeAgent-mine", signedInBy: EVA, state: "reconnect" }),
  ]) {
    const [choice] = mateLoginChoices(mateLoginRows(snapshot([row]), null), EVA);
    expect(choice?.use.usable).toBe(false);
  }
});

// witness: packages/client-runtime/src/zerops/logins.ts | registering: { state: "local-only", providerAuth: "unknown", credPresent: true }, → registering: { state: "authorized", providerAuth: "authenticated", credPresent: true },
it("ZV83: A login beyond an agent's default reads, wherever an agent row is asked, in its own state, with its own signer and its own sign-in under way, never as its agent's default login", () => {
  for (const state of [
    "authorized",
    "registering",
    "reconnect",
    "needs-reauth",
    "not-authorized",
  ] as const) {
    const row = mateLoginAsAgentRow(login({ id: "claudeAgent-work", state, signedInBy: EVA }));
    expect(classifyZeropsAgentAuth(row).kind).toBe(state);
    expect(row.flagToken).toBe(false);
  }

  const walking = {
    phase: "menu",
    terminalId: "agent-login-codex-home",
    startedAt: "2026-09-27T10:00:00.000Z",
  } as unknown as NonNullable<ZeropsLogin["login"]>;
  const row = mateLoginAsAgentRow(
    login({ id: "codex-home", agent: "codex", signedInBy: JAN, login: walking }),
  );
  expect(row.agentId).toBe("codex");
  expect(row.authorizedBy).toEqual({ subject: JAN });
  expect(row.login).toBe(walking);
});

// witness: packages/client-runtime/src/zerops/logins.ts | const login = snapshot.logins?.find((entry) => !entry.default && entry.id === instanceId); → const login = snapshot.logins?.find((entry) => entry.id === instanceId);
it("ZV84: A thread spends a login beyond the defaults by that login's own row, and any other instance, one configured by hand included, by its driver's agent row; nothing is spent on a driver Mate signs nobody in to, or without a feed", () => {
  const feed: ZeropsAgentAuthSnapshot = {
    available: true,
    agents: [
      {
        agentId: "claude-code",
        credPresent: true,
        flagOAuth: true,
        flagToken: false,
        providerAuth: "authenticated",
        state: "authorized",
        authorizedBy: { subject: JAN },
      },
    ],
    logins: [
      login({ id: "claudeAgent", default: true, signedInBy: JAN }),
      login({ id: "claudeAgent-work", signedInBy: EVA }),
    ],
  };
  const providers = [
    { instanceId: "claudeAgent", driver: "claudeAgent" },
    { instanceId: "claudeAgent-work", driver: "claudeAgent" },
    { instanceId: "claudeAgent_mine", driver: "claudeAgent" },
  ];

  for (const { instanceId, key, signer } of [
    { instanceId: "claudeAgent-work", key: "claudeAgent-work", signer: EVA },
    { instanceId: "claudeAgent", key: "claude-code", signer: JAN },
    // Configured by hand, not a login Mate made: its driver's own login.
    { instanceId: "claudeAgent_mine", key: "claude-code", signer: JAN },
  ]) {
    const spent = resolveSpentLogin(instanceId, feed, providers);
    expect(spent?.key).toBe(key);
    expect(spent?.agent.authorizedBy?.subject).toBe(signer);
  }

  expect(resolveSpentLogin("opencode", feed, providers)).toBeUndefined();
  expect(resolveSpentLogin(undefined, feed, providers)).toBeUndefined();
  expect(resolveSpentLogin("claudeAgent-work", null, providers)).toBeUndefined();
});
