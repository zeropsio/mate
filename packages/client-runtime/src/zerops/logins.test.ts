import type { ZeropsAgentAuthSnapshot, ZeropsLogin } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { crewSnapshotFixture } from "./crew/testing/fixtures.ts";
import { classifyZeropsAgentAuth } from "@t3tools/shared/zeropsAgentAuth";

import {
  mateLoginAsAgentRow,
  mateLoginChoices,
  mateLoginRows,
  mateLoginSignerLine,
  resolveSpentLogin,
} from "./logins.ts";

const EVA = "u-eva";
const JAN = "u-jan";

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

describe("mateLoginRows", () => {
  it("titles every login and names the crewmates that run on it", () => {
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

    expect(rows.map((row) => [row.id, row.title, row.crewmates, row.lead])).toEqual([
      ["claudeAgent", "Claude Code", ["Backend"], null],
      ["claudeAgent-work", "Claude Code · work", ["Frontend"], null],
      ["codex", "Codex", [], null],
    ]);
  });

  it("names the lead among the crewmates of the login it runs on, by name", () => {
    const base = crewSnapshotFixture();
    const rows = mateLoginRows(
      snapshot([login({ id: "claudeAgent", default: true, signedInBy: EVA })]),
      base,
    );
    expect(rows.map((row) => [row.crewmates, row.lead])).toEqual([
      [["Lead", "Backend", "Frontend"], "Lead"],
    ]);
  });

  it("lists nothing from a server that lists no logins, or no feed at all", () => {
    expect(mateLoginRows(snapshot(undefined), null)).toEqual([]);
    expect(mateLoginRows(null, null)).toEqual([]);
  });
});

describe("mateLoginSignerLine", () => {
  it.each([
    [login({ id: "claudeAgent", default: true, signedInBy: EVA }), "Signed in by you"],
    [login({ id: "claudeAgent-cleo", signedInBy: JAN }), "Signed in by Jan"],
    [login({ id: "claudeAgent-x", signedInBy: "u-left" }), "Signed in by another member"],
    [login({ id: "codex-home", agent: "codex", state: "not-authorized" }), "Not signed in"],
    [login({ id: "claudeAgent-y" }), "Sign-in not recorded"],
    [login({ id: "claudeAgent-key", kind: "apiKey", signedInBy: EVA }), "Added by you"],
    [login({ id: "claudeAgent-key", kind: "apiKey", signedInBy: JAN }), "Added by Jan"],
    [login({ id: "claudeAgent-key", kind: "apiKey", state: "not-authorized" }), "No key stored"],
    [
      login({ id: "codex", agent: "codex", default: true, token: true }),
      "Authorized by a project token",
    ],
  ])("%o reads %s", (row, line) => {
    expect(mateLoginSignerLine(row, EVA, (userId) => (userId === JAN ? "Jan" : undefined))).toBe(
      line,
    );
  });
});

// N9: a crewmate runs only on a login its person signed in, or on a project
// token — what the server's admission accepts, row for row.
describe("mateLoginChoices", () => {
  it.each([
    [login({ id: "claudeAgent-mine", signedInBy: EVA }), { usable: true }],
    [login({ id: "claudeAgent-mine", signedInBy: EVA, state: "registering" }), { usable: true }],
    [login({ id: "codex", agent: "codex", default: true, token: true }), { usable: true }],
    [
      login({ id: "claudeAgent-cleo", signedInBy: JAN }),
      {
        usable: false,
        reason: "Signed in by another project member — only their crews can use it.",
      },
    ],
    [
      login({ id: "claudeAgent-y" }),
      {
        usable: false,
        reason: "Its sign-in was not recorded by Zerops Mate, so nobody can run it.",
      },
    ],
    [
      login({ id: "codex-home", agent: "codex", label: "home", state: "not-authorized" }),
      {
        usable: false,
        reason: "Codex · home is not signed in on this project. Sign it in to use it.",
      },
    ],
  ])("%o → %o", (row, use) => {
    const [choice] = mateLoginChoices(mateLoginRows(snapshot([row]), null), EVA);
    expect(choice?.use).toEqual(use);
  });
});

// Surfaces written against agent rows (ownership, the composer's gate) read a
// login beyond the defaults through a row that classifies exactly as it does.
describe("mateLoginAsAgentRow", () => {
  it.each(["authorized", "registering", "reconnect", "needs-reauth", "not-authorized"] as const)(
    "classifies as the login does when it is %s",
    (state) => {
      const row = mateLoginAsAgentRow(login({ id: "claudeAgent-work", state, signedInBy: EVA }));
      expect(classifyZeropsAgentAuth(row).kind).toBe(state);
      expect(row.flagToken).toBe(false);
    },
  );

  it("carries the login's own signer and walker", () => {
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
});

// The instance a thread spends, as the server's admission resolves it: a
// login beyond the defaults by its own row, anything else by its driver.
describe("resolveSpentLogin", () => {
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

  it.each([
    { instanceId: "claudeAgent-work", key: "claudeAgent-work", signer: EVA },
    { instanceId: "claudeAgent", key: "claude-code", signer: JAN },
    // Configured by hand, not a login Mate made: its driver's own login.
    { instanceId: "claudeAgent_mine", key: "claude-code", signer: JAN },
  ])("$instanceId spends $key", ({ instanceId, key, signer }) => {
    const spent = resolveSpentLogin(instanceId, feed, providers);
    expect(spent?.key).toBe(key);
    expect(spent?.agent.authorizedBy?.subject).toBe(signer);
  });

  it("spends nothing Mate signs nobody in to, and nothing without a feed", () => {
    expect(resolveSpentLogin("opencode", feed, providers)).toBeUndefined();
    expect(resolveSpentLogin(undefined, feed, providers)).toBeUndefined();
    expect(resolveSpentLogin("claudeAgent-work", null, providers)).toBeUndefined();
  });
});

// The server's provider status and the Mate's sign-in record are two streams. Past the
// registration the record says authorized while the status still says "being registered":
// the record wins, and the stale status says nothing (the owner, 2026-09-30: "there still
// flashes …, which layout shifts").
