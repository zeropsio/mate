import { expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ZeropsUserId,
  type ServerProvider,
  type ZeropsAgentAuthSnapshot,
  type ZeropsLogin,
} from "@t3tools/contracts";
import type { Known } from "../../zerops/knowledge/index.ts";
import { agentAdmission } from "./agentAdmission.ts";
// witness: packages/client-runtime/src/data/projections/agentAdmission.ts | const auth = spent === undefined ? null : classifyZeropsAgentAuth(spent.agent).kind; → const auth = spent === undefined ? null : classifyZeropsAgentAuth({ ...spent.agent, providerAuth: "unknown" }).kind;
it("PJ68: Only a proved failed provider login asks for sign-in: an unknown or an authenticated one does not", () => {
  for (const providerAuth of ["unknown", "authenticated", "unauthenticated"] as const) {
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
          authorizedBy: { subject: ZeropsUserId.make("viewer") },
        },
      ],
    } as const;
    const words =
      agentAdmission({
        owner: null,
        environmentId: "rig",
        instanceId: ProviderInstanceId.make("codex"),
        viewerSubject: ZeropsUserId.make("viewer"),
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
  }
});

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
const derive = (
  read: Known<ZeropsAgentAuthSnapshot>,
  hqSigners?: Readonly<Record<string, ZeropsUserId>>,
) =>
  agentAdmission({
    owner: null,
    environmentId: "env-Ada",
    instanceId: provider.instanceId,
    viewerSubject: ZeropsUserId.make("viewer"),
    read,
    hqSigners,
    providers: [provider],
    mateName: "Ada",
  });

const signedInBy = (subject: ZeropsUserId, token = false): ZeropsAgentAuthSnapshot => ({
  ...ready,
  agents: ready.agents.map((agent) => ({
    ...agent,
    flagToken: token,
    state: token ? "authorized-token" : "authorized",
    authorizedBy: { subject },
  })),
});
const composer = (
  snapshot: ZeropsAgentAuthSnapshot,
  hqSigners?: Readonly<Record<string, ZeropsUserId>>,
) => {
  const { footer, canSend, sendBlockReason } = derive(known(snapshot), hqSigners);
  return { footer, canSend, sendBlockReason };
};
const anotherMembersSignIn = {
  footer: "read-only",
  canSend: false,
  sendBlockReason: "Signed in by another project member — only they can run this agent.",
};
const usableComposer = { footer: "composer", canSend: true, sendBlockReason: null };

// witness: packages/client-runtime/src/data/projections/agentAdmission.ts | const signerRefuses = ownership === "someone-else" || ownership === "unrecorded"; → const signerRefuses = ownership === "unrecorded";
it("PJ69: An agent another member signed in replaces the composer with whose sign-in it is, and the member's own agent restores it", () => {
  expect([
    composer(signedInBy(ZeropsUserId.make("colleague"))),
    composer(signedInBy(ZeropsUserId.make("viewer"))),
  ]).toEqual([anotherMembersSignIn, usableComposer]);
});

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
// witness: packages/client-runtime/src/data/projections/agentAdmission.ts | return input.owner?.mine === false || input.operate === false; → return input.owner?.mine === true || input.operate === false;
it("PJ70: A colleague's Mate, as HQ records whose it is, is read along and never written to", () => {
  for (const [owner, footer, asks] of [
    [{ mine: true }, "composer", true],
    [{ mine: false }, "read-only", false],
  ] as const) {
    const admission = agentAdmission({
      environmentId: "rig",
      instanceId: ProviderInstanceId.make("claudeAgent"),
      viewerSubject: ZeropsUserId.make("viewer"),
      read: signedOut,
      providers: [],
      mateName: "Wren",
      owner,
    });
    expect(admission.footer).toBe(footer);
    expect(admission.readOnly).toBe(footer === "read-only");
    expect(admission.canSend).toBe(false);
    expect(admission.attention !== null).toBe(asks);
  }
});

// witness: packages/client-runtime/src/data/projections/agentAdmission.ts | return input.owner?.mine === false || input.operate === false; → return input.owner?.mine === false;
it("PJ+5: Losing the right to operate a project natively closes its Mate's composer, though its owner stays signed in; breaks: a person downgraded to Read only keeps a composer whose sends the server refuses", () => {
  const input = {
    environmentId: "mate",
    instanceId: undefined,
    viewerSubject: ZeropsUserId.make("viewer"),
    owner: { mine: true },
    read: known({ available: true, agents: [] }),
    providers: [],
    mateName: "Wren",
  } as const;
  const admitted = (operate: boolean) => {
    const { footer, canSend, readOnly } = agentAdmission({ ...input, operate });
    return { footer, canSend, readOnly };
  };
  expect([admitted(true), admitted(false)]).toEqual([
    { footer: "composer", canSend: true, readOnly: false },
    { footer: "read-only", canSend: false, readOnly: true },
  ]);
});

// witness: packages/client-runtime/src/data/projections/agentAdmission.ts | spent.agent.flagToken || → false ||
it("PJ+6: A login a project token authorizes keeps the composer open, though another member signed in last; breaks: a project-token login reads as a colleague's and every other member loses the composer", () => {
  const colleague = ZeropsUserId.make("colleague");
  expect([composer(signedInBy(colleague)).footer, composer(signedInBy(colleague, true))]).toEqual([
    "read-only",
    usableComposer,
  ]);
});

const login = (patch: Partial<ZeropsLogin> & Pick<ZeropsLogin, "id">): ZeropsLogin => ({
  agent: "claude-code",
  label: "",
  kind: "subscription",
  default: false,
  state: "not-authorized",
  token: false,
  ...patch,
});
// witness: packages/client-runtime/src/data/projections/agentAdmission.ts | source.loginId === attention.loginKey → source.loginId !== attention.loginKey
it("PJ+7: A refusal is explained on the login whose id it names, never on another login by the same label or words; breaks: one login's sign-in prompt claims another login's refusal, or a renamed login loses its own", () => {
  const work = ProviderInstanceId.make("claudeAgent-work");
  const other = ProviderInstanceId.make("claudeAgent-other");
  const refusalSource = { loginId: "claudeAgent-work", reason: "missing-sign-in" } as const;
  const explains = (
    instanceId: ProviderInstanceId,
    logins: ReadonlyArray<ZeropsLogin>,
    source: { readonly loginId: string; readonly reason: "missing-sign-in" } = refusalSource,
  ) =>
    agentAdmission({
      owner: null,
      environmentId: "env-Ada",
      instanceId,
      viewerSubject: ZeropsUserId.make("viewer"),
      mateName: "Ada",
      providers: [work, other].map((id) => ({
        ...provider,
        instanceId: id,
        displayName: "Claude Code · before",
      })),
      read: known({ ...ready, logins }),
      refusalSource: source,
    }).explainsRefusal;
  const before = [
    login({ id: "claudeAgent-work", label: "before" }),
    login({ id: "claudeAgent-other", label: "before" }),
  ];
  expect([
    explains(work, before),
    explains(other, before),
    explains(work, [login({ id: "claudeAgent-work", label: "after" })]),
    explains(work, before, { loginId: "Claude Code · before", reason: "missing-sign-in" }),
  ]).toEqual([true, false, true, false]);
});

// witness: packages/client-runtime/src/data/projections/agentAdmission.ts | if (input.automated === true) return automatedAdmission(input); → if (input.automated === false) return automatedAdmission(input);
it("PJ+8: An automated Mate never asks a person to sign in: it runs on an agent nobody signs in to, and without a usable one it waits for the organization's API key; breaks: an automated Mate's composer asks a person to sign in to a subscription agent", () => {
  // Whole provider rows, `models`, `skills` and `slashCommands` included: admission reads them.
  const opencode = (status: "ready" | "error"): ServerProvider => ({
    ...provider,
    instanceId: ProviderInstanceId.make("opencode"),
    driver: ProviderDriverKind.make("opencode"),
    status,
    auth: { status: "unknown" },
  });
  const claude: ServerProvider = { ...provider, auth: { status: "unauthenticated" } };
  const admit = (providers: ReadonlyArray<ServerProvider>) => {
    const { attention, holdsComposer, canSend } = agentAdmission({
      owner: { mine: true },
      automated: true,
      empty: true,
      environmentId: "rig",
      // The thread's model, a subscription agent: nobody may sign it in here.
      instanceId: provider.instanceId,
      viewerSubject: ZeropsUserId.make("viewer"),
      providers,
      mateName: "Nova",
      read: known({
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
      }),
    });
    return { attention, holdsComposer, canSend };
  };
  expect([
    admit([claude, opencode("ready")]),
    admit([claude, opencode("error")]),
    admit([claude]),
  ]).toEqual([
    { attention: null, holdsComposer: false, canSend: true },
    { attention: null, holdsComposer: false, canSend: false },
    { attention: null, holdsComposer: false, canSend: false },
  ]);
});
