import { describe, expect, it } from "vite-plus/test";

import type {
  ProviderInstanceConfig,
  ZeropsAgentAuthSnapshot,
  ZeropsLogin,
} from "@t3tools/contracts";

import {
  mateLoginInstance,
  mateLoginRow,
  mateLoginState,
  readMateLogins,
  withLogins,
} from "./ZeropsLogins.ts";

const HOME = "/home/zerops";
const loginHome = (id: string) => `${HOME}/.mate/logins/${id}`;

const instance = (config: Record<string, unknown>): ProviderInstanceConfig =>
  config as unknown as ProviderInstanceConfig;

describe("readMateLogins", () => {
  it.each([
    {
      name: "a second Claude account",
      id: "claudeAgent-work",
      entry: {
        driver: "claudeAgent",
        displayName: "Claude Code · work",
        config: { homePath: loginHome("claudeAgent-work") },
      },
      login: {
        id: "claudeAgent-work",
        agent: "claude-code",
        kind: "subscription",
        label: "work",
        home: loginHome("claudeAgent-work"),
        keyStored: false,
      },
    },
    {
      name: "a home written with a tilde",
      id: "claudeAgent-work",
      entry: {
        driver: "claudeAgent",
        displayName: "Claude Code · work",
        config: { homePath: "~/.mate/logins/claudeAgent-work" },
      },
      login: {
        id: "claudeAgent-work",
        agent: "claude-code",
        kind: "subscription",
        label: "work",
        home: loginHome("claudeAgent-work"),
        keyStored: false,
      },
    },
    {
      name: "a Claude API key",
      id: "claudeAgent-team",
      entry: {
        driver: "claudeAgent",
        displayName: "Claude API key · team",
        config: { homePath: loginHome("claudeAgent-team") },
        environment: [{ name: "ANTHROPIC_API_KEY", value: "sk-ant-1", sensitive: true }],
      },
      login: {
        id: "claudeAgent-team",
        agent: "claude-code",
        kind: "apiKey",
        label: "team",
        home: loginHome("claudeAgent-team"),
        keyStored: true,
      },
    },
    {
      name: "a Claude API key whose key the store lost",
      id: "claudeAgent-api-key",
      entry: {
        driver: "claudeAgent",
        displayName: "Claude API key",
        config: { homePath: loginHome("claudeAgent-api-key") },
        environment: [
          { name: "ANTHROPIC_API_KEY", value: "", sensitive: true, valueRedacted: true },
        ],
      },
      login: {
        id: "claudeAgent-api-key",
        agent: "claude-code",
        kind: "apiKey",
        label: "",
        home: loginHome("claudeAgent-api-key"),
        keyStored: false,
      },
    },
    {
      name: "a second Codex account, on a shadow home over the shared one",
      id: "codex-home",
      entry: {
        driver: "codex",
        displayName: "Codex · home",
        config: { shadowHomePath: loginHome("codex-home") },
      },
      login: {
        id: "codex-home",
        agent: "codex",
        kind: "subscription",
        label: "home",
        home: loginHome("codex-home"),
        keyStored: false,
      },
    },
    {
      name: "a display name somebody changed by hand",
      id: "codex-home",
      entry: {
        driver: "codex",
        displayName: "Personal",
        config: { shadowHomePath: loginHome("codex-home") },
      },
      login: {
        id: "codex-home",
        agent: "codex",
        kind: "subscription",
        label: "Personal",
        home: loginHome("codex-home"),
        keyStored: false,
      },
    },
  ])("reads $name", ({ id, entry, login }) => {
    expect(readMateLogins({ [id]: instance(entry) }, HOME)).toEqual([login]);
  });

  // Only what Mate made is a login: an instance someone configured by hand
  // keeps today's rule (its driver's default signer), never a login of its own.
  it.each([
    {
      name: "a hand-made second instance",
      id: "claudeAgent_work",
      entry: { driver: "claudeAgent", config: { homePath: "~/.claude-work" } },
    },
    {
      name: "a login id whose home lies elsewhere",
      id: "claudeAgent-work",
      entry: { driver: "claudeAgent", config: { homePath: "~/.claude-work" } },
    },
    {
      name: "another login's home",
      id: "claudeAgent-work",
      entry: { driver: "claudeAgent", config: { homePath: loginHome("claudeAgent-home") } },
    },
    {
      name: "a Codex login on a direct home rather than a shadow",
      id: "codex-home",
      entry: { driver: "codex", config: { homePath: loginHome("codex-home") } },
    },
    {
      name: "a driver the id does not name",
      id: "codex-home",
      entry: { driver: "claudeAgent", config: { homePath: loginHome("codex-home") } },
    },
    {
      name: "a default instance",
      id: "claudeAgent",
      entry: { driver: "claudeAgent", config: { homePath: loginHome("claudeAgent") } },
    },
  ])("does not read $name as a login", ({ id, entry }) => {
    expect(readMateLogins({ [id]: instance(entry) }, HOME)).toEqual([]);
  });
});

describe("mateLoginInstance", () => {
  it.each([
    { id: "claudeAgent-work", agent: "claude-code", kind: "subscription", label: "work" },
    {
      id: "claudeAgent-api-key",
      agent: "claude-code",
      kind: "apiKey",
      label: "",
      apiKey: "sk-ant-1",
    },
    { id: "codex-home", agent: "codex", kind: "subscription", label: "home" },
  ] as const)("writes $id so it reads back as the same login", (input) => {
    const { apiKey, ...login } = { apiKey: undefined, ...input };
    const written = mateLoginInstance({ ...login, apiKey }, HOME);
    expect(readMateLogins({ [login.id]: written }, HOME)).toEqual([
      { ...login, home: loginHome(login.id), keyStored: apiKey !== undefined },
    ]);
  });

  it("names the instance as every surface names the login, and stores the key as a secret", () => {
    expect(
      mateLoginInstance(
        {
          id: "claudeAgent-team",
          agent: "claude-code",
          kind: "apiKey",
          label: "team",
          apiKey: "k",
        },
        HOME,
      ),
    ).toEqual({
      driver: "claudeAgent",
      displayName: "Claude API key · team",
      config: { homePath: loginHome("claudeAgent-team") },
      environment: [{ name: "ANTHROPIC_API_KEY", value: "k", sensitive: true }],
    });
  });
});

// No platform flag: a login's own CLI check decides, and an API key is signed
// in the moment it is stored.
describe("mateLoginState", () => {
  it.each([
    [
      { kind: "subscription", keyStored: false, credPresent: false, providerAuth: "unknown" },
      "not-authorized",
    ],
    [
      { kind: "subscription", keyStored: false, credPresent: false, providerAuth: "authenticated" },
      "not-authorized",
    ],
    [
      { kind: "subscription", keyStored: false, credPresent: true, providerAuth: "unknown" },
      "registering",
    ],
    [
      { kind: "subscription", keyStored: false, credPresent: true, providerAuth: "authenticated" },
      "authorized",
    ],
    [
      {
        kind: "subscription",
        keyStored: false,
        credPresent: true,
        providerAuth: "unauthenticated",
      },
      "needs-reauth",
    ],
    [
      { kind: "apiKey", keyStored: true, credPresent: false, providerAuth: "unknown" },
      "authorized",
    ],
    [
      { kind: "apiKey", keyStored: false, credPresent: false, providerAuth: "unknown" },
      "not-authorized",
    ],
  ] as const)("%o is %s", (facts, state) => {
    expect(mateLoginState(facts)).toBe(state);
  });
});

describe("withLogins", () => {
  const agents: ZeropsAgentAuthSnapshot["agents"] = [
    {
      agentId: "claude-code",
      credPresent: true,
      flagOAuth: true,
      flagToken: false,
      providerAuth: "authenticated",
      state: "authorized",
      authorizedBy: { subject: "u-eva" },
    },
    {
      agentId: "codex",
      credPresent: false,
      flagOAuth: false,
      flagToken: true,
      providerAuth: "unknown",
      state: "authorized-token",
    },
  ];
  const work: ZeropsLogin = {
    id: "claudeAgent-work",
    agent: "claude-code",
    label: "work",
    kind: "subscription",
    default: false,
    state: "authorized",
    token: false,
    signedInBy: "u-jan",
  };

  it("lists the defaults from their agent rows and leaves the agents as they are", () => {
    const snapshot = { available: true, agents };
    const merged = withLogins(snapshot, []);
    expect(merged.agents).toBe(agents);
    expect(merged.logins).toEqual([
      {
        id: "claudeAgent",
        agent: "claude-code",
        label: "",
        kind: "subscription",
        default: true,
        state: "authorized",
        token: false,
        signedInBy: "u-eva",
      },
      {
        id: "codex",
        agent: "codex",
        label: "",
        kind: "subscription",
        default: true,
        state: "authorized",
        token: true,
      },
    ]);
  });

  it("lists every other login after the defaults", () => {
    const merged = withLogins({ available: true, agents }, [work]);
    expect(merged.logins?.map((login) => login.id)).toEqual(["claudeAgent", "codex", work.id]);
  });

  it("lists nothing where the feed is off", () => {
    const off = { available: false, reason: "Not a Zerops environment", agents: [] };
    expect(withLogins(off, [work])).toBe(off);
  });
});

describe("mateLoginRow", () => {
  const login = {
    id: "claudeAgent-work",
    agent: "claude-code",
    kind: "subscription",
    label: "work",
    home: loginHome("claudeAgent-work"),
    keyStored: false,
  } as const;

  it("carries its own signer, and nobody's without a credential", () => {
    const facts = { credPresent: true, providerAuth: "authenticated" } as const;
    expect(mateLoginRow(login, facts, "u-jan")).toEqual({
      id: "claudeAgent-work",
      agent: "claude-code",
      label: "work",
      kind: "subscription",
      default: false,
      state: "authorized",
      token: false,
      signedInBy: "u-jan",
    });
    expect(
      mateLoginRow(login, { credPresent: false, providerAuth: "unknown" }, "u-jan").signedInBy,
    ).toBeUndefined();
  });
});
