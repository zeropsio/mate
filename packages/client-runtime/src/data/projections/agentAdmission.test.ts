import { describe, expect, it } from "vite-plus/test";
import {
  ProviderInstanceId,
  ProviderDriverKind,
  type ServerProvider,
  type ZeropsAgentAuthSnapshot,
  type ZeropsLogin,
} from "@t3tools/contracts";
import { agentAdmission, admissionProviderStatus } from "./agentAdmission.ts";

it.each(["unknown", "authenticated", "unauthenticated"] as const)(
  "only a proved failed provider login asks for sign-in (%s)",
  (providerAuth) => {
    const snapshot = {
      available: true,
      agents: [
        {
          agentId: "codex",
          credPresent: true,
          flagOAuth: true,
          flagToken: false,
          state: "authorized",
          providerAuth,
          authorizedBy: { subject: "viewer" },
        },
      ],
    } as const;
    const instanceId = ProviderInstanceId.make("codex");
    const words =
      agentAdmission({
        environmentId: "rig",
        instanceId,
        viewerSubject: "viewer",
        read: {
          state: "known",
          value: snapshot,
          asOf: { ordinal: 1, atMs: 0 },
          coverage: "complete",
          freshness: { kind: "live" },
        },
        providers: [],
        mateName: "Wren",
      }).attention?.text ?? null;
    expect(words).toBe(
      providerAuth === "unauthenticated"
        ? "Wren's Codex login no longer works. Sign in again to continue."
        : null,
    );
  },
);

const login = (patch: Partial<ZeropsLogin> & Pick<ZeropsLogin, "id">): ZeropsLogin => ({
  agent: "claude-code",
  label: "",
  kind: "subscription",
  default: false,
  state: "authorized",
  token: false,
  ...patch,
});
describe("admission config evidence", () => {
  const providers = [
    { instanceId: "claudeAgent", driver: "claudeAgent" },
    { instanceId: "claudeAgent-work", driver: "claudeAgent" },
    { instanceId: "opencode", driver: "opencode" },
  ];
  const agentRow = (
    state: "local-only" | "authorized" | "not-authorized",
    providerAuth: "unknown" | "authenticated" | "unauthenticated",
  ) =>
    ({
      agentId: "claude-code",
      credPresent: state !== "not-authorized",
      flagOAuth: state === "authorized",
      flagToken: false,
      providerAuth,
      state,
    }) as const;
  const REGISTERING =
    "Claude Code is signed in and being registered with Zerops. It will be ready in a moment.";
  const registeringWord = {
    instanceId: "claudeAgent",
    status: "warning",
    message: REGISTERING,
  } as const;
  const authorized = { available: true, agents: [agentRow("authorized", "authenticated")] };
  const notSignedInWord = {
    instanceId: "claudeAgent",
    status: "error",
    message: "Claude Code is not signed in on this project. Sign it in to use it.",
  } as const;

  it.each([
    {
      name: "the default login signed in and its flag not written yet",
      status: registeringWord,
      feed: { available: true, agents: [agentRow("local-only", "unknown")] },
      expected: true,
    },
    {
      name: "the default login registered while its status still says it is being registered",
      status: registeringWord,
      feed: authorized,
      expected: true,
    },
    {
      name: "the record not caught up yet while the status already says it is being registered",
      status: registeringWord,
      feed: { available: true, agents: [agentRow("not-authorized", "unauthenticated")] },
      expected: true,
    },
    {
      name: "a login beyond the defaults still answering its own check",
      status: {
        instanceId: "claudeAgent-work",
        status: "warning",
        message: "Claude Code · work is signed in and being checked. It will be ready in a moment.",
      },
      feed: {
        ...authorized,
        logins: [login({ id: "claudeAgent-work", label: "work", state: "registering" })],
      },
      expected: true,
    },
    // The sign-in's own moment: the composer picks the agent off the sign-in feed, and the
    // provider statuses — another stream, debounced on the server — still carry the answer from
    // before it.
    {
      name: "the default login just signed in while its status still says it is not",
      status: notSignedInWord,
      feed: { available: true, agents: [agentRow("local-only", "unknown")] },
      expected: true,
    },
    {
      name: "the default login registered while its status still says it is not signed in",
      status: notSignedInWord,
      feed: authorized,
      expected: true,
    },
    {
      name: "a login beyond the defaults signed in while its status still says it is not",
      status: {
        instanceId: "claudeAgent-work",
        status: "error",
        message: "Claude Code · work is not signed in on this project. Sign it in to use it.",
      },
      feed: {
        ...authorized,
        logins: [login({ id: "claudeAgent-work", label: "work", state: "registering" })],
      },
      expected: true,
    },
    // A real failure says so at once: the sign-in feed agrees with the status.
    {
      name: "the default login not signed in, and its status says so",
      status: notSignedInWord,
      feed: { available: true, agents: [agentRow("not-authorized", "unknown")] },
      expected: true,
    },
    {
      name: "the default login no longer working, and its status says so",
      status: {
        instanceId: "claudeAgent",
        status: "error",
        message: "Claude Code's login on this project no longer works. Sign in again.",
      },
      feed: { available: true, agents: [agentRow("authorized", "unauthenticated")] },
      expected: true,
    },
    {
      name: "a login beyond the defaults not signed in, and its status says so",
      status: {
        instanceId: "claudeAgent-work",
        status: "error",
        message: "Claude Code · work is not signed in on this project. Sign it in to use it.",
      },
      feed: {
        ...authorized,
        logins: [login({ id: "claudeAgent-work", label: "work", state: "not-authorized" })],
      },
      expected: true,
    },
    {
      name: "a driver's own warning on a registered login (its check could not answer)",
      status: {
        instanceId: "claudeAgent",
        status: "warning",
        message: "Could not verify Claude authentication status.",
      },
      feed: authorized,
      expected: false,
    },
    {
      name: "a driver's error on a registered login (a revoked credential)",
      status: { instanceId: "claudeAgent", status: "error", message: "Not signed in." },
      feed: authorized,
      expected: false,
    },
    {
      name: "the agent disabled in settings",
      status: {
        instanceId: "claudeAgent",
        status: "warning",
        message: "Claude is disabled in settings.",
      },
      feed: authorized,
      expected: false,
    },
    {
      name: "a ready status (a version advisory) on a registered login",
      status: { instanceId: "claudeAgent", status: "ready", message: REGISTERING },
      feed: authorized,
      expected: false,
    },
    {
      name: "a provider Mate signs nobody in to",
      status: { instanceId: "opencode", status: "warning", message: REGISTERING },
      feed: authorized,
      expected: false,
    },
    { name: "no feed", status: registeringWord, feed: null, expected: true },
    { name: "no status", status: null, feed: authorized, expected: false },
  ])("is $expected for $name", ({ status, feed, expected }) => {
    expect(
      admissionProviderStatus(status, feed as ZeropsAgentAuthSnapshot | null, providers) === null &&
        status !== null,
    ).toBe(expected);
  });
});

it("A cold auth read does not present stale managed sign-in guidance as a runtime error", () => {
  expect(
    admissionProviderStatus(
      {
        instanceId: "claudeAgent",
        driver: "claudeAgent",
        installed: true,
        auth: { status: "unknown" },
        status: "error",
        message: "Claude Code is not signed in on this project. Sign it in to use it.",
      },
      null,
      [{ instanceId: "claudeAgent", driver: "claudeAgent" }],
    ),
  ).toBeNull();
});

it.each(["unsupported", "broken"] as const)(
  "A signed-out Antigravity has admission guidance alongside its %s version advisory",
  (status) => {
    const provider: ServerProvider = {
      instanceId: ProviderInstanceId.make("antigravity"),
      driver: ProviderDriverKind.make("antigravity"),
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "error",
      auth: { status: "unauthenticated" },
      checkedAt: "2026-10-08T00:00:00Z",
      models: [],
      skills: [],
      slashCommands: [],
      message: "Sign in with Google to use Antigravity.",
      compatibilityAdvisory: {
        status,
        message: "Use a supported version.",
        recommendedVersion: null,
        recommendedRange: null,
      },
    };
    const result = agentAdmission({
      environmentId: "env",
      instanceId: provider.instanceId,
      viewerSubject: "viewer",
      read: undefined,
      providers: [provider],
      mateName: "Ada",
    });
    expect(result.attention).toMatchObject({ cause: "missing-sign-in", action: "sign-in" });
    expect(result.providerStatus).toMatchObject({
      status: "ready",
      message: undefined,
      compatibilityAdvisory: { status },
    });
  },
);

describe("one admission answer for composer, Send and Continue", () => {
  const snapshot = {
    available: true,
    agents: [
      {
        agentId: "codex",
        credPresent: true,
        flagOAuth: true,
        flagToken: false,
        providerAuth: "authenticated",
        state: "authorized",
        authorizedBy: { subject: "another" },
      },
    ],
  } as const;
  const base = {
    environmentId: "rig",
    instanceId: "codex",
    viewerSubject: "viewer",
    providers: [],
    mateName: "Wren",
  } as const;
  it.each(["unread", "reading"] as const)(
    "A cold %s holds Send and Continue without inventing sign-in guidance",
    (state) => {
      expect(
        agentAdmission({
          ...base,
          read:
            state === "unread" ? { state, waitingFor: null } : { state, sinceMs: 0, attempt: 1 },
        }),
      ).toMatchObject({
        attention: null,
        footer: "held",
        canSend: false,
        readOnly: false,
      });
    },
  );
  it("Decision: admission does not invent signer ownership. Drop unrecorded-login and any blocking derived from who signed in.", () => {
    expect(
      agentAdmission({
        ...base,
        read: {
          state: "known",
          value: snapshot,
          asOf: { ordinal: 1, atMs: 0 },
          coverage: "complete",
          freshness: { kind: "live" },
        },
      }),
    ).toMatchObject({
      attention: null,
      footer: "composer",
      canSend: true,
      readOnly: false,
    });
  });
});
