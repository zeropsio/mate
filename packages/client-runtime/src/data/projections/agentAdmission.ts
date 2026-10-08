import type { Projection } from "../store.ts";
import type { MateProjectKey } from "./mateAttention.ts";
import { hqMateOverview, hqMatePresence } from "./hqMates.ts";
import { sameValue } from "./equal.ts";
import type {
  ProviderInstanceId,
  ZeropsAgentId,
  ServerProvider,
  ZeropsAgentAuthSnapshot,
} from "@t3tools/contracts";
import { agentIdForDriverKind } from "@t3tools/contracts";
import {
  resolveZeropsAgentAvailability,
  resolveZeropsAgentOwnership,
  zeropsAgentAvailabilityIsRunnable,
  zeropsAgentAuthReads,
  zeropsLoginAuthReads,
  type ZeropsAgentAvailability,
} from "../../zerops/agentAvailability.ts";
import type { Known } from "../../zerops/knowledge/index.ts";
import { resolveSpentLogin } from "../../zerops/logins.ts";
import {
  resolveAgentAuthorizer,
  agentOwnershipComposerNotice,
} from "../../zerops/agentOwnership.ts";
import { signedOutAgent, agentNeedsSignIn } from "../../zerops/agentSignIn.ts";
import {
  zeropsAgentUnavailableReason,
  zeropsLoginUnavailableReason,
  zeropsLoginTitle,
} from "@t3tools/shared/zeropsAgentAuth";

export function resolveZeropsProviderAvailability(input: {
  readonly entries: ReadonlyArray<{
    readonly instanceId: ProviderInstanceId;
    readonly driverKind: string;
  }>;
  readonly agentAuth: Known<ZeropsAgentAuthSnapshot> | undefined;
  readonly viewerSubject: string | undefined;
}): ReadonlyMap<ProviderInstanceId, ZeropsAgentAvailability> | undefined {
  if (input.agentAuth === undefined) return undefined;
  /** A row's facts, its signer resolved — an agent's own, or a login's (`mateLoginAsAgentRow`). */
  const factsOf = (agent: ZeropsAgentAuthSnapshot["agents"][number]) => ({
    credPresent: agent.credPresent,
    flagToken: agent.flagToken,
    providerAuth: agent.providerAuth,
    verification: agent.verification,
    registration: agent.registration,
    state: agent.state,
    loginPhase: agent.login?.phase,
    authorizedBy: resolveAgentAuthorizer(agent, input.viewerSubject),
  });
  const reads = zeropsAgentAuthReads(input.agentAuth, factsOf);
  if (reads === undefined) return undefined;
  // A login beyond the defaults answers for itself, as the server's admission
  // resolves it; until the feed is known, its driver's agent says `unknown`
  // for it like for every other instance.
  const loginReads = zeropsLoginAuthReads(input.agentAuth, factsOf);
  const map = new Map<ProviderInstanceId, ZeropsAgentAvailability>();
  for (const entry of input.entries) {
    const login = loginReads(entry.instanceId);
    if (login !== undefined) {
      map.set(
        entry.instanceId,
        resolveZeropsAgentAvailability({ agent: login, viewerSubject: input.viewerSubject }),
      );
      continue;
    }
    const agentId = agentIdForDriverKind(entry.driverKind);
    if (agentId === undefined) continue;
    const agent = reads(agentId);
    if (agent === undefined) continue;
    map.set(
      entry.instanceId,
      resolveZeropsAgentAvailability({ agent, viewerSubject: input.viewerSubject }),
    );
  }
  return map;
}

export interface AgentAdmissionAttention {
  readonly key: string;
  readonly cause:
    | "missing-sign-in"
    | "sign-in-in-progress"
    | "expired-login"
    | "another-signer"
    | "unrecorded-login";
  readonly instanceId: string;
  readonly loginKey: string;
  readonly agentId: ZeropsAgentId | undefined;
  readonly severity: "attention";
  readonly dismissible: false;
  readonly text: string;
  readonly summary: string;
  readonly action:
    | "sign-in"
    | "continue-sign-in"
    | "manage-api-key"
    | "check-again"
    | "register-again";
  readonly actionLabel: string;
  readonly refusalMessages: ReadonlyArray<string>;
}

/** Admission owns managed-login policy. Config lag and failed turns never establish current admission. */
export function agentAdmission(input: {
  readonly environmentId: string;
  readonly instanceId: string | undefined;
  readonly viewerSubject: string | undefined;
  readonly snapshot: ZeropsAgentAuthSnapshot | null;
  readonly availability: ReadonlyMap<ProviderInstanceId, ZeropsAgentAvailability> | undefined;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly mateName: string;
}) {
  const candidates = input.providers.filter(
    (provider) => provider.enabled && provider.status !== "disabled",
  );
  const anyRunnable = candidates.some((provider) => {
    const availability = input.availability?.get(provider.instanceId);
    return availability === undefined
      ? provider.status === "ready"
      : availability.kind === "ready" ||
          availability.kind === "registering" ||
          availability.kind === "unknown";
  });
  const instanceId =
    input.instanceId ??
    (anyRunnable
      ? undefined
      : candidates.find(
          (provider) =>
            input.availability?.get(provider.instanceId)?.kind === "needs-sign-in" ||
            input.availability?.get(provider.instanceId)?.kind === "signing-in" ||
            input.availability?.get(provider.instanceId)?.kind === "someone-else" ||
            input.availability?.get(provider.instanceId)?.kind === "unrecorded",
        )?.instanceId);
  const provider = input.providers.find((p) => p.instanceId === instanceId) ?? null;
  const spent = resolveSpentLogin(instanceId, input.snapshot, input.providers);
  const spentLogin = input.snapshot?.logins?.find((row) => !row.default && row.id === spent?.key);
  const available =
    instanceId === undefined
      ? undefined
      : input.availability?.get(instanceId as ProviderInstanceId);
  const managed =
    spent !== undefined ||
    available !== undefined ||
    agentIdForDriverKind(provider?.driver) !== undefined;
  const providerStatus = admissionProviderStatus(provider, input.snapshot, input.providers);
  const cliSignIn = provider !== null && providerNeedsSignIn(provider);
  let attention: AgentAdmissionAttention | null = null;
  const cause = admissionCause(available) ?? (!managed && cliSignIn ? "missing-sign-in" : null);
  // An unidentified viewer cannot earn a person-scoped ownership assertion.
  if (cause !== null && instanceId !== undefined && input.viewerSubject !== undefined) {
    attention = admissionAttention({
      environmentId: input.environmentId,
      instanceId,
      viewerSubject: input.viewerSubject,
      loginKey: spent?.key ?? instanceId,
      agentId: spent?.agent.agentId,
      cause,
      mateName: input.mateName,
      agentName:
        spentLogin !== undefined
          ? zeropsLoginTitle(spentLogin)
          : (provider?.displayName ?? "coding agent"),
      refusalMessages:
        spent === undefined ? [] : admissionRefusalMessages(spent.agent.agentId, spentLogin),
      action:
        spentLogin?.kind === "apiKey"
          ? "manage-api-key"
          : available?.kind === "signing-in"
            ? "continue-sign-in"
            : (available?.ended?.action ?? "sign-in"),
    });
  }
  return { attention, providerStatus };
}

export interface AgentRefusalSource {
  readonly instanceId: string;
  readonly driver: string;
}

/** A refusal remains dated history; only the refused instance's current admission explains it. */
export function admissionExplainsRefusal(
  attention: AgentAdmissionAttention | null,
  error: string | null,
  source: AgentRefusalSource | undefined,
): boolean {
  return (
    attention !== null &&
    source !== undefined &&
    source.instanceId === attention.instanceId &&
    (agentNeedsSignIn(error ?? "", source.driver) ||
      attention.refusalMessages.includes(error ?? ""))
  );
}

function admissionCause(
  available: ZeropsAgentAvailability | undefined,
): AgentAdmissionAttention["cause"] | null {
  switch (available?.kind) {
    case "signing-in":
      return "sign-in-in-progress";
    case "needs-sign-in":
      return available.signInKind === "needs-reauth" ? "expired-login" : "missing-sign-in";
    case "someone-else":
      return "another-signer";
    case "unrecorded":
      return "unrecorded-login";
    default:
      return null;
  }
}

function admissionAttention(input: {
  readonly environmentId: string;
  readonly instanceId: string;
  readonly viewerSubject: string;
  readonly loginKey: string;
  readonly agentId: ZeropsAgentId | undefined;
  readonly cause: AgentAdmissionAttention["cause"];
  readonly mateName: string;
  readonly agentName: string;
  readonly action: AgentAdmissionAttention["action"];
  readonly refusalMessages: ReadonlyArray<string>;
}): AgentAdmissionAttention {
  const { cause, action } = input;
  const agentName =
    input.loginKey === input.agentId && input.agentId === "codex"
      ? "Codex"
      : input.loginKey === input.agentId && input.agentId === "claude-code"
        ? "Claude"
        : input.agentName;
  const text =
    action === "manage-api-key"
      ? `${input.mateName}'s ${agentName} is unavailable. Update its key in Settings to continue.`
      : cause === "sign-in-in-progress"
        ? `${input.mateName}'s ${agentName} sign-in is not finished. Continue authorization to use it.`
        : cause === "another-signer" || cause === "unrecorded-login"
          ? agentOwnershipComposerNotice(
              cause === "another-signer" ? "someone-else" : "unrecorded",
            )!
          : cause === "expired-login"
            ? `${input.mateName}'s ${agentName} login no longer works. Sign in again to continue.`
            : `${input.mateName} needs a ${agentName} sign-in to continue.`;
  return {
    ...input,
    key: JSON.stringify([
      input.environmentId,
      input.instanceId,
      input.loginKey,
      input.viewerSubject,
      cause,
    ]),
    severity: "attention",
    dismissible: false,
    text,
    summary:
      action === "manage-api-key"
        ? "API key required"
        : cause === "sign-in-in-progress"
          ? "Finish sign-in"
          : cause === "another-signer"
            ? "Another signer's login"
            : cause === "unrecorded-login"
              ? "Sign-in not recorded"
              : "Sign in",
    actionLabel:
      action === "manage-api-key"
        ? "Manage API key"
        : action === "continue-sign-in"
          ? "Continue authorization"
          : action === "check-again"
            ? "Check again"
            : action === "register-again"
              ? "Register again"
              : cause === "another-signer" || cause === "unrecorded-login"
                ? "Sign in with your own account"
                : "Sign in",
  };
}

/** Compact any-agent query over the menu's existing live overview; historical errors are not admission. */
export const mateAdmissionSummary: Projection<
  MateProjectKey & { readonly viewerSubject: string | undefined; readonly mateName: string },
  AgentAdmissionAttention | null
> = {
  name: "mateAdmissionSummary",
  keyOf: (key) => JSON.stringify([key.orgId, key.projectId, key.viewerSubject, key.mateName]),
  equals: sameValue,
  derive: (read, key) => {
    const overview = hqMateOverview.derive(read, key);
    const live = hqMatePresence.derive(read, key).live;
    if (
      !live ||
      overview?.presence.overview !== "live" ||
      overview.presence.online !== true ||
      overview.identity?.environmentId === undefined ||
      overview.logins === undefined ||
      key.viewerSubject === undefined
    )
      return null;
    if (overview.identity.runsWithoutSignIn) return null;
    // HQ proves presence and signer ownership, but carries no evidence of expiry.
    const entries = Object.entries(overview.logins).map(([id, login]) => ({
      id,
      availability: !login.present
        ? ({ kind: "needs-sign-in", signInKind: "not-authorized" } as const)
        : login.token
          ? ({ kind: "ready" } as const)
          : resolveZeropsAgentOwnership(
              {
                authorizedBy: login.signedInBy === null ? undefined : { subject: login.signedInBy },
                viewerSubject: key.viewerSubject,
              },
              "authorized",
            ),
    }));
    if (entries.some((entry) => zeropsAgentAvailabilityIsRunnable(entry.availability))) return null;
    const entry = entries.find(({ id }) => id === "claude-code" || id === "codex");
    if (entry === undefined) return null;
    const agentId = entry.id as ZeropsAgentId;
    const cause = admissionCause(entry.availability);
    if (cause === null) return null;
    return admissionAttention({
      environmentId: overview.identity.environmentId,
      instanceId: agentId === "claude-code" ? "claudeAgent" : "codex",
      loginKey: agentId,
      agentId,
      viewerSubject: key.viewerSubject,
      cause,
      mateName: key.mateName,
      agentName: "coding agent",
      refusalMessages: admissionRefusalMessages(agentId, undefined),
      action: "sign-in",
    });
  },
};

/** Normalize only admission evidence. Independent install, runtime and compatibility failures stay visible. */
export function admissionProviderStatus<
  T extends {
    readonly instanceId: string;
    readonly status: string;
    readonly message?: string | undefined;
    readonly driver?: string;
    readonly installed?: boolean;
    readonly auth?: { readonly status: string };
    readonly compatibilityAdvisory?: { readonly status: string } | undefined;
  },
>(
  provider: T | null,
  snapshot: ZeropsAgentAuthSnapshot | null,
  providers: ReadonlyArray<{ readonly instanceId: string; readonly driver: string }>,
) {
  if (
    provider === null ||
    provider.installed === false ||
    (provider.status !== "warning" && provider.status !== "error")
  )
    return provider;
  const spent = resolveSpentLogin(provider.instanceId, snapshot, providers);
  const agentId =
    spent?.agent.agentId ??
    agentIdForDriverKind(
      provider.driver ?? providers.find((row) => row.instanceId === provider.instanceId)?.driver,
    );
  const login = snapshot?.logins?.find((row) => !row.default && row.id === spent?.key);
  const kinds = ["registering", "reconnect", "needs-reauth", "not-authorized"] as const;
  const managedWords =
    agentId !== undefined &&
    kinds.some(
      (kind) =>
        provider.message ===
        (login === undefined
          ? zeropsAgentUnavailableReason(agentId, kind)
          : zeropsLoginUnavailableReason(login, kind)),
    );
  const cliWords = providerNeedsSignIn(provider);
  if (!managedWords && !cliWords) return provider;
  // Admission owns the auth part even when config also carries a version advisory.
  // Keep that independent evidence without presenting the obsolete auth error again.
  return provider.compatibilityAdvisory?.status === "broken" ||
    provider.compatibilityAdvisory?.status === "unsupported"
    ? { ...provider, status: "ready" as const, message: undefined }
    : null;
}

function providerNeedsSignIn(provider: {
  readonly installed?: boolean;
  readonly auth?: { readonly status: string };
  readonly message?: string | undefined;
  readonly driver?: string;
}): boolean {
  return (
    provider.installed === true &&
    provider.auth?.status === "unauthenticated" &&
    (!provider.message ||
      (provider.driver === "antigravity" &&
        provider.message === "Sign in with Google to use Antigravity.") ||
      agentNeedsSignIn(provider.message, provider.driver) ||
      /^(?:Not signed in\.|Not authenticated\.|Authentication required\.)/u.test(provider.message))
  );
}

export function admissionRefusalWords(
  error: string,
  driver: string | null | undefined,
  mateName: string | undefined,
): string | null {
  const agent = signedOutAgent(error, driver);
  return agent === null
    ? null
    : `${mateName ?? "This Mate"}'s turn could not continue because ${agent} was signed out.`;
}

/** Exact scoped gate vocabulary, never a broad authentication regex (Git refusals stay independent). */
function admissionRefusalMessages(
  agentId: ZeropsAgentId,
  login: import("@t3tools/contracts").ZeropsLogin | undefined,
): ReadonlyArray<string> {
  const kinds = ["not-authorized", "needs-reauth", "reconnect"] as const;
  const title = login === undefined ? undefined : zeropsLoginTitle(login);
  return [
    ...kinds.map((kind) =>
      login === undefined
        ? zeropsAgentUnavailableReason(agentId, kind)
        : zeropsLoginUnavailableReason(login, kind),
    ),
    title === undefined
      ? "This agent's sign-in was not recorded by Zerops Mate, so nobody can run it. Sign in with your own account first."
      : `${title}'s sign-in was not recorded by Zerops Mate, so nobody can run it. Sign it in with your own account first.`,
    title === undefined
      ? "This agent was signed in by another project member — only they can run it. Sign in with your own account first."
      : `${title} was signed in by another project member — only they can run it. Use a login you signed in yourself.`,
  ];
}
