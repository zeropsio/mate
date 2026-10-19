import { describe, expect, it } from "vite-plus/test";
import {
  ProviderInstanceId,
  ProviderDriverKind,
  type ServerProvider,
  type ZeropsAgentAuthSnapshot,
  type ZeropsLogin,
} from "@t3tools/contracts";
import type { Known } from "../../zerops/knowledge/index.ts";
import { AtomRegistry } from "effect/reactivity";
import { EnvironmentId } from "@t3tools/contracts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import {
  admissionNeedsSignIn,
  agentAdmission,
  admissionProviderStatus,
  engineRunRefusal,
  mateAdmissionSummary,
} from "./agentAdmission.ts";

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
        owner: null,
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
      owner: null,
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
          owner: null,
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
    for (const subject of [undefined, "viewer", "another"]) {
      const value = {
        ...snapshot,
        agents: snapshot.agents.map((agent) => ({
          ...agent,
          authorizedBy: subject === undefined ? undefined : { subject },
        })),
      };
      expect(
        agentAdmission({
          owner: null,
          ...base,
          read: {
            state: "known",
            value,
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
    }
  });
});

describe("mateArrivalHoldsComposer", () => {
  it.each([
    { standUpHolds: true, signInRequired: false, empty: false, holds: true },
    { standUpHolds: false, signInRequired: true, empty: true, holds: true },
    // A conversation under way keeps its composer, whatever its sign-in says: it is read.
    { standUpHolds: false, signInRequired: true, empty: false, holds: false },
    { standUpHolds: false, signInRequired: false, empty: true, holds: false },
  ])(
    "stand-up $standUpHolds, no agent $signInRequired, empty $empty: holds $holds",
    ({ holds, signInRequired, ...input }) => {
      expect(
        agentAdmission({
          owner: null,
          ...input,
          environmentId: "rig",
          instanceId: "codex",
          viewerSubject: "viewer",
          providers: [],
          mateName: "Fen",
          read: {
            state: "known",
            asOf: { ordinal: 1, atMs: 0 },
            coverage: "complete",
            freshness: { kind: "live" },
            value: {
              available: true,
              agents: [
                {
                  agentId: "codex",
                  credPresent: !signInRequired,
                  flagOAuth: !signInRequired,
                  flagToken: false,
                  providerAuth: signInRequired ? "unauthenticated" : "authenticated",
                  state: signInRequired ? "not-authorized" : "authorized",
                },
              ],
            },
          },
        }).holdsComposer,
      ).toBe(holds);
    },
  );
});

describe("admissionNeedsSignIn", () => {
  const known = (authorized: boolean) =>
    ({
      state: "known",
      asOf: { ordinal: 1, atMs: 0 },
      coverage: "complete",
      freshness: { kind: "live" },
      value: {
        available: true,
        agents: [
          {
            agentId: "codex",
            credPresent: authorized,
            flagOAuth: authorized,
            flagToken: false,
            providerAuth: authorized ? "authenticated" : "unauthenticated",
            state: authorized ? "authorized" : "not-authorized",
          },
        ],
      },
    }) as const;
  it.each([
    ["needs a sign-in where no agent is signed in", known(false), true],
    ["needs none once an agent is signed in", known(true), false],
    ["says nothing until the agents' sign-in is read", undefined, false],
  ] as const)("%s", (_title, read, needs) => {
    expect(admissionNeedsSignIn(read, [])).toBe(needs);
  });
});

describe("a colleague's Mate, as HQ records whose it is", () => {
  // The owner (2026-10-12): "this mate is not mine and I can still see the composer".
  const signedOut = {
    state: "known",
    value: {
      available: true,
      agents: [
        {
          agentId: "claude-code",
          credPresent: false,
          flagOAuth: false,
          flagToken: false,
          state: "not-authorized",
          providerAuth: "unknown",
        },
      ],
    },
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete",
    freshness: { kind: "live" },
  } as const;
  it.each([
    { case: "HQ has not said", owner: undefined, footer: "held", asks: false },
    { case: "HQ names nobody, or has not said", owner: null, footer: "composer", asks: true },
    {
      case: "HQ records it as the viewer's",
      owner: { mine: true },
      footer: "composer",
      asks: true,
    },
    {
      case: "HQ records it as a colleague's",
      owner: { mine: false },
      footer: "read-only",
      asks: false,
    },
  ] as const)(
    "is read along, never written to, when it is a colleague's: $case",
    ({ owner, footer, asks }) => {
      const admission = agentAdmission({
        environmentId: "rig",
        instanceId: ProviderInstanceId.make("claudeAgent"),
        viewerSubject: "viewer",
        read: signedOut,
        providers: [],
        mateName: "Wren",
        owner,
      });
      expect(admission.footer).toBe(footer);
      expect(admission.readOnly).toBe(footer === "read-only");
      expect(admission.canSend).toBe(false);
      // Its sign-in is its owner's to give: nobody else is asked for it.
      expect(admission.attention !== null).toBe(asks);
    },
  );
});

describe("an engine run admission refused", () => {
  const refused = {
    kind: "failed",
    reason: "Claude's sign-in has expired.",
    next: null,
    admission: { loginId: "claude-code", reason: "expired-login" },
  } as const;
  it.each([
    [
      "names the login its refusal was for",
      [{ ordinal: 1, end: refused }],
      { loginId: "claude-code", reason: "expired-login" },
    ],
    [
      "is over once a later run goes",
      [
        { ordinal: 2, end: null },
        { ordinal: 1, end: refused },
      ],
      undefined,
    ],
    [
      "is no refusal when a run failed on its own",
      [{ ordinal: 1, end: { kind: "failed", reason: "The agent process failed.", next: null } }],
      undefined,
    ],
    [
      "joins nothing for a reason this build does not know",
      [
        {
          ordinal: 1,
          end: { ...refused, admission: { loginId: "claude-code", reason: "unknown" } },
        },
      ],
      undefined,
    ],
    ["is nothing before the conversation's runs are read", undefined, undefined],
  ] as const)("%s", (_, runs, expected) => {
    expect(engineRunRefusal(runs)).toEqual(expected);
  });
});

// The conversation reads this auth evidence, not the provider config's previous answer.
describe("admission on the conversation's auth input", () => {
  const provider: ServerProvider = {
    instanceId: ProviderInstanceId.make("claudeAgent"),
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    installed: true,
    version: "1",
    status: "error",
    auth: { status: "unknown" },
    message: "Claude Code is not signed in on this project. Sign it in to use it.",
    checkedAt: "2026-10-08T00:00:00Z",
    models: [],
    skills: [],
    slashCommands: [],
  };
  const ready: ZeropsAgentAuthSnapshot = {
    available: true,
    agents: [
      {
        agentId: "claude-code",
        credPresent: true,
        flagOAuth: true,
        flagToken: false,
        state: "authorized",
        providerAuth: "authenticated",
      },
    ],
  };
  const known = (value: ZeropsAgentAuthSnapshot): Known<ZeropsAgentAuthSnapshot> => ({
    state: "known",
    value,
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete",
    freshness: { kind: "live" },
  });
  const derive = (read: Known<ZeropsAgentAuthSnapshot>) =>
    agentAdmission({
      owner: null,
      environmentId: "env-Ada",
      instanceId: provider.instanceId,
      viewerSubject: "viewer",
      read,
      providers: [provider],
      mateName: "Ada",
    });

  it("A cold auth read holds sending without flashing stale sign-in guidance", () => {
    const states: ReadonlyArray<Known<ZeropsAgentAuthSnapshot>> = [
      { state: "unread", waitingFor: null },
      { state: "reading", sinceMs: 0, attempt: 1 },
      { state: "reading", sinceMs: 0, attempt: 2 },
      known(ready),
    ];
    // Every observed cold state holds input and Send; the first authoritative answer releases both.
    expect(
      states.map((read) => {
        const answer = derive(read);
        return {
          text: answer.attention?.text ?? null,
          footer: answer.footer,
          canSend: answer.canSend,
          providerMessage: answer.providerStatus?.message ?? null,
        };
      }),
    ).toEqual([
      { text: null, footer: "held", canSend: false, providerMessage: null },
      { text: null, footer: "held", canSend: false, providerMessage: null },
      { text: null, footer: "held", canSend: false, providerMessage: null },
      { text: null, footer: "composer", canSend: true, providerMessage: null },
    ]);
  });

  it("Decision: unknown is not healthy — if the auth read fails or is unsupported and the config says Not signed in, the explanation shows; only a cold, not-yet-read state is suppressed.", () => {
    const states: ReadonlyArray<Known<ZeropsAgentAuthSnapshot>> = [
      { state: "unread", waitingFor: null },
      { state: "reading", sinceMs: 0, attempt: 1 },
      {
        state: "failed",
        failure: {
          kind: "refused",
          code: "EnvironmentAuthorizationError",
          words: "This auth read was refused.",
        },
        atMs: 0,
        attempt: 1,
        retryAtMs: null,
      },
      known({ available: false, reason: "unsupported", agents: [] }),
    ];
    expect(
      states.map((read) => {
        const answer = derive(read);
        return {
          text: answer.attention?.text ?? null,
          action: answer.attention?.actionLabel ?? null,
          canSend: answer.canSend,
        };
      }),
    ).toEqual([
      { text: null, action: null, canSend: false },
      { text: null, action: null, canSend: false },
      { text: "Ada needs a Claude sign-in to continue.", action: "Sign in", canSend: false },
      { text: "Ada needs a Claude sign-in to continue.", action: "Sign in", canSend: false },
    ]);
  });

  it("Decision: refusals correlate by login identity (id), never by label or message text.", () => {
    const input = {
      environmentId: "env-Ada",
      viewerSubject: "viewer",
      mateName: "Ada",
      providers: [
        {
          ...provider,
          instanceId: ProviderInstanceId.make("claudeAgent-work"),
          displayName: "Claude Code · before",
        },
        {
          ...provider,
          instanceId: ProviderInstanceId.make("claudeAgent-other"),
          displayName: "Claude Code · before",
        },
      ],
    };
    const before = known({
      ...ready,
      logins: [
        login({ id: "claudeAgent-work", label: "before", state: "not-authorized" }),
        login({ id: "claudeAgent-other", label: "before", state: "not-authorized" }),
      ],
    });
    const refusalSource = { loginId: "claudeAgent-work", reason: "missing-sign-in" } as const;
    const attempted = agentAdmission({
      owner: null,
      ...input,
      instanceId: "claudeAgent-work",
      read: before,
      refusalSource,
    });
    const sameLabel = agentAdmission({
      owner: null,
      ...input,
      instanceId: "claudeAgent-other",
      read: before,
      refusalSource,
    });
    expect(attempted.explainsRefusal).toBe(true);
    expect(sameLabel.attention?.text).toBe(attempted.attention?.text);
    expect(sameLabel.explainsRefusal).toBe(false);
    const after = agentAdmission({
      owner: null,
      ...input,
      instanceId: "claudeAgent-work",
      refusalSource,
      read: known({
        ...ready,
        logins: [login({ id: "claudeAgent-work", label: "after", state: "not-authorized" })],
      }),
    });
    expect(after.explainsRefusal).toBe(true);
    expect(after.attention).toMatchObject({
      loginKey: "claudeAgent-work",
      text: "Ada needs a Claude Code · after sign-in to continue.",
    });
    expect(
      agentAdmission({
        owner: null,
        ...input,
        instanceId: "claudeAgent-work",
        read: before,
        refusalSource: { loginId: "Claude Code · before", reason: "missing-sign-in" },
      }).explainsRefusal,
    ).toBe(false);
  });
});

// History and provider readiness can arrive before HQ's ownership evidence.
it.each([
  { case: "unresolved", owner: undefined, footer: "held", canSend: false },
  { case: "affirmatively unowned", owner: null, footer: "composer", canSend: true },
  { case: "Mine", owner: { mine: true }, footer: "composer", canSend: true },
  { case: "a colleague's", owner: { mine: false }, footer: "read-only", canSend: false },
] as const)(
  "HQ ownership $case admits only its supported controls",
  ({ owner, footer, canSend }) => {
    const admission = agentAdmission({
      environmentId: "rig",
      instanceId: "codex",
      viewerSubject: "viewer",
      mateName: "Cyd",
      providers: [],
      owner,
      read: {
        state: "known",
        value: {
          available: true,
          agents: [
            {
              agentId: "codex",
              state: "authorized",
              providerAuth: "authenticated",
              credPresent: true,
              flagOAuth: true,
              flagToken: false,
            },
          ],
        },
        asOf: { ordinal: 1, atMs: 0 },
        coverage: "complete",
        freshness: { kind: "live" },
      },
    });
    expect(
      admission.footer,
      "ASSERTION: unresolved HQ ownership never offers writable controls",
    ).toBe(footer);
    expect(admission.canSend).toBe(canSend);
    expect(admission.attention).toBeNull();
  },
);

it("a native project downgrade closes the composer even while its owner stays signed in", () => {
  const input = {
    environmentId: "mate",
    instanceId: undefined,
    viewerSubject: "viewer",
    owner: { mine: true },
    read: {
      state: "known",
      value: { available: true, agents: [] },
      asOf: { ordinal: 1, atMs: 0 },
      coverage: "complete",
      freshness: { kind: "live" },
    },
    providers: [],
    mateName: "Wren",
  } as const;
  expect(agentAdmission({ ...input, operate: true }).canSend).toBe(true);
  const downgraded = agentAdmission({ ...input, operate: false });
  expect(
    downgraded.footer,
    "ASSERTION: native read-only permission closes the real composer admission",
  ).toBe("read-only");
  expect(downgraded.canSend).toBe(false);
  expect(downgraded.readOnly).toBe(true);
  expect(downgraded.sendBlockReason).toBe("You have Read access to this Mate.");
});

describe("the menu's sign-in summary", () => {
  it.each([
    ["an ordinary Mate nobody signed in asks for a sign-in", false, "Sign in"],
    ["an automated Mate runs on the organization's key and asks for none", true, null],
  ] as const)("%s", (_case, automated, action) => {
    const store = makeAccountStore(AtomRegistry.make());
    seedHqNavigation(store, "org", {
      structure: {
        apps: [
          {
            id: "shop",
            name: "Shop",
            projects: [
              { projectId: "nova", name: "Nova", kind: "mate", mate: { face: "", automated } },
            ],
          },
        ],
        ungrouped: [],
      },
      mates: {
        nova: {
          presence: { online: true, since: "2026-10-17T00:00:00Z", overview: "live" },
          identity: {
            environmentId: EnvironmentId.make("nova-env"),
            serverVersion: "1",
            update: null,
          },
          logins: {
            "claude-code": { signedInBy: null, present: false, token: false },
          },
        },
      },
    });
    const summary = mateAdmissionSummary.derive(readsOfState(store.state()), {
      orgId: "org",
      projectId: "nova",
      viewerSubject: "viewer",
      mateName: "Nova",
    });
    expect(summary?.actionLabel ?? null).toBe(action);
  });
});

describe("an automated Mate's composer", () => {
  const opencode = (status: "ready" | "error") =>
    ({
      instanceId: "opencode",
      driver: "opencode",
      enabled: true,
      installed: true,
      status,
      auth: { status: "unknown" },
    }) as never;
  const claude = {
    instanceId: "claudeAgent",
    driver: "claudeAgent",
    enabled: true,
    installed: true,
    status: "error",
    auth: { status: "unauthenticated" },
  } as never;
  const admit = (providers: ReadonlyArray<never>) =>
    agentAdmission({
      owner: { mine: true },
      automated: true,
      empty: true,
      environmentId: "rig",
      // The thread's model, a subscription agent: nobody may sign it in here.
      instanceId: "claudeAgent",
      viewerSubject: "viewer",
      providers,
      mateName: "Nova",
      read: {
        state: "known",
        asOf: { ordinal: 1, atMs: 0 },
        coverage: "complete",
        freshness: { kind: "live" },
        value: {
          available: true,
          agents: [
            {
              agentId: "claude-code",
              credPresent: false,
              flagOAuth: false,
              flagToken: false,
              providerAuth: "unauthenticated",
              state: "not-authorized",
            },
          ],
        },
      },
    });

  it("never asks for a sign-in nor holds its composer for one", () => {
    expect(admit([claude, opencode("ready")])).toMatchObject({
      attention: null,
      holdsComposer: false,
      canSend: true,
      sendBlockReason: null,
    });
  });

  it.each([
    ["OpenCode not ready", [claude, opencode("error")]],
    ["no agent but a subscription one", [claude]],
  ] as const)(
    "without a usable agent says it waits for the organization's API key: %s",
    (_case, providers) => {
      expect(admit(providers)).toMatchObject({
        attention: null,
        holdsComposer: false,
        canSend: false,
        sendBlockReason: "Nova waits for your organization's API key.",
      });
    },
  );
});

describe("a sent message never silently stays in the composer", () => {
  const agent = (signedIn: boolean) =>
    ({
      agentId: "codex",
      credPresent: signedIn,
      flagOAuth: signedIn,
      flagToken: false,
      providerAuth: signedIn ? "authenticated" : "unauthenticated",
      state: signedIn ? "authorized" : "not-authorized",
      authorizedBy: signedIn ? { subject: "viewer" } : undefined,
    }) as const;
  const opencode = {
    instanceId: "opencode",
    driver: "opencode",
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "unknown" },
  } as never;
  const admit = (input: {
    readonly signedIn: boolean;
    readonly standUpHolds?: boolean;
    readonly empty?: boolean;
    readonly automated?: boolean;
  }) =>
    agentAdmission({
      owner: { mine: true },
      environmentId: "rig",
      instanceId: input.automated === true ? "opencode" : "codex",
      viewerSubject: "viewer",
      providers: input.automated === true ? [opencode] : [],
      mateName: "Lumo",
      standUpHolds: input.standUpHolds === true,
      empty: input.empty === true,
      automated: input.automated === true,
      read: {
        state: "known",
        asOf: { ordinal: 1, atMs: 0 },
        coverage: "complete",
        freshness: { kind: "live" },
        value: { available: true, agents: [agent(input.signedIn)] },
      },
    });

  it.each([
    {
      name: "its person's stand-up holds it, the agent signed in",
      input: { signedIn: true, standUpHolds: true, empty: true },
      reason: "Lumo is standing up development. You can write once it has started.",
    },
    {
      name: "an automated Mate's stand-up holds it",
      input: { signedIn: false, standUpHolds: true, empty: true, automated: true },
      reason: "Lumo is standing up development. You can write once it has started.",
    },
    {
      name: "its agent is not signed in",
      input: { signedIn: false, empty: true },
      reason: "Lumo needs a Codex sign-in to continue.",
    },
  ])("a send it cannot take says why: $name", ({ input, reason }) => {
    const admission = admit(input);
    expect(admission.footer).toBe("composer");
    expect(admission.canSend).toBe(false);
    expect(admission.sendBlockReason).toBe(reason);
  });
});
