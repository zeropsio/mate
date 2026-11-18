import { expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ZeropsUserId,
  type ServerProvider,
  type ZeropsAgentAuthSnapshot,
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
