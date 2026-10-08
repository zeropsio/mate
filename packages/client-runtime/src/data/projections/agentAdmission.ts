import type { Projection } from "../store.ts";
import type { MateProjectKey } from "./mateAttention.ts";
import { hqMateOverview, hqMatePresence } from "./hqMates.ts";
import { sameValue } from "./equal.ts";
import type {
  ProviderInstanceId,
  ZeropsAgentId,
  ServerProvider,
  ZeropsAgentAuthSnapshot,
  AgentAdmissionRefusal,
} from "@t3tools/contracts";
import { agentIdForDriverKind, agentIdForProviderInstance } from "@t3tools/contracts";
import type { Known } from "../../zerops/knowledge/index.ts";
import { resolveSpentLogin } from "../../zerops/logins.ts";
import { signedOutAgent } from "../../zerops/agentSignIn.ts";
import {
  classifyZeropsAgentAuth,
  zeropsAgentUnavailableReason,
  zeropsLoginUnavailableReason,
  zeropsLoginTitle,
} from "@t3tools/shared/zeropsAgentAuth";
import { agentAuthAction } from "../../zerops/agentLogin.ts";

export interface AgentAdmissionAttention {
  readonly key: string;
  readonly cause: "missing-sign-in" | "expired-login" | "sign-in-in-progress";
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
    | "settings"
    | "check-again"
    | "register-again";
  readonly actionLabel: string;
}

/** Auth establishes admission; a signer's identity establishes no client permission. */
export function agentAdmission(input: {
  readonly environmentId: string;
  readonly instanceId: string | undefined;
  readonly viewerSubject: string | undefined;
  readonly read: Known<ZeropsAgentAuthSnapshot> | undefined;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly mateName: string;
}) {
  const snapshot = input.read?.state === "known" ? input.read.value : null;
  const provider = input.providers.find((p) => p.instanceId === input.instanceId) ?? null;
  const spent = resolveSpentLogin(input.instanceId, snapshot, input.providers);
  const login = snapshot?.logins?.find((row) => !row.default && row.id === spent?.key);
  const cold = input.read?.state === "unread" || input.read?.state === "reading";
  const auth = spent === undefined ? null : classifyZeropsAgentAuth(spent.agent).kind;
  const pending = spent?.agent.login;
  const inProgress =
    pending !== undefined &&
    pending.phase !== "succeeded" &&
    pending.phase !== "failed" &&
    pending.phase !== "cancelled";
  const cause = cold
    ? null
    : auth === "authorized" || auth === "registering"
      ? null
      : inProgress
        ? "sign-in-in-progress"
        : auth === "needs-reauth" || auth === "reconnect"
          ? "expired-login"
          : auth === "not-authorized" ||
              (spent === undefined &&
                provider !== null &&
                (providerNeedsSignIn(provider) ||
                  configAuthKind(provider, snapshot, input.providers) === "not-authorized" ||
                  configAuthKind(provider, snapshot, input.providers) === "needs-reauth"))
            ? "missing-sign-in"
            : null;
  const anotherStarted =
    inProgress && pending.startedBy !== undefined && pending.startedBy !== input.viewerSubject;
  const action =
    login?.kind === "apiKey"
      ? "manage-api-key"
      : anotherStarted
        ? "settings"
        : inProgress
          ? "continue-sign-in"
          : spent === undefined
            ? "sign-in"
            : agentAuthAction(spent.agent);
  const attention =
    cause === null || input.instanceId === undefined
      ? null
      : admissionAttention({
          environmentId: input.environmentId,
          instanceId: input.instanceId,
          loginKey: spent?.key ?? agentIdForProviderInstance(input.instanceId) ?? input.instanceId,
          agentId: spent?.agent.agentId ?? agentIdForDriverKind(provider?.driver),
          cause,
          mateName: input.mateName,
          agentName:
            login === undefined
              ? (provider?.displayName ?? "coding agent")
              : zeropsLoginTitle(login),
          action: action === "none" || action === "registering" ? "sign-in" : action,
        });
  return {
    attention,
    providerStatus: admissionProviderStatus(provider, snapshot, input.providers),
  };
}

export type AgentRefusalSource = AgentAdmissionRefusal;

/** A typed refusal joins the selected login by ID, regardless of labels or words. */
export function admissionExplainsRefusal(
  attention: AgentAdmissionAttention | null,
  source: AgentAdmissionRefusal | undefined,
): boolean {
  return (
    attention !== null &&
    source !== undefined &&
    source.reason !== "not-permitted" &&
    source.loginId === attention.loginKey
  );
}

function admissionAttention(input: {
  readonly environmentId: string;
  readonly instanceId: string;
  readonly loginKey: string;
  readonly agentId: ZeropsAgentId | undefined;
  readonly cause: AgentAdmissionAttention["cause"];
  readonly mateName: string;
  readonly agentName: string;
  readonly action: AgentAdmissionAttention["action"];
}): AgentAdmissionAttention {
  const { cause, action } = input;
  const agentName =
    input.loginKey === "codex"
      ? "Codex"
      : input.loginKey === "claude-code"
        ? "Claude"
        : input.agentName;
  const text =
    action === "manage-api-key"
      ? `${input.mateName}'s ${agentName} is unavailable. Update its key in Settings to continue.`
      : action === "settings"
        ? `Another project member started ${input.mateName}'s ${agentName} sign-in. Open Settings to manage this login.`
        : cause === "sign-in-in-progress"
          ? `${input.mateName}'s ${agentName} sign-in is not finished. Continue authorization to use it.`
          : cause === "expired-login"
            ? `${input.mateName}'s ${agentName} login no longer works. Sign in again to continue.`
            : `${input.mateName} needs a ${agentName} sign-in to continue.`;
  return {
    ...input,
    key: JSON.stringify([input.environmentId, input.loginKey, cause]),
    severity: "attention",
    dismissible: false,
    text,
    summary:
      action === "manage-api-key"
        ? "API key required"
        : cause === "sign-in-in-progress"
          ? "Finish sign-in"
          : "Sign in",
    actionLabel:
      action === "manage-api-key"
        ? "Manage API key"
        : action === "settings"
          ? "Settings"
          : action === "continue-sign-in"
            ? "Continue authorization"
            : action === "check-again"
              ? "Check again"
              : action === "register-again"
                ? "Register again"
                : "Sign in",
  };
}

/** HQ's existing compact login facts can show absence, never infer permission from a signer. */
export const mateAdmissionSummary: Projection<
  MateProjectKey & { readonly viewerSubject: string | undefined; readonly mateName: string },
  AgentAdmissionAttention | null
> = {
  name: "mateAdmissionSummary",
  keyOf: (key) => JSON.stringify([key.orgId, key.projectId, key.mateName]),
  equals: sameValue,
  derive: (read, key) => {
    const overview = hqMateOverview.derive(read, key);
    if (
      !hqMatePresence.derive(read, key).live ||
      overview?.presence.overview !== "live" ||
      overview.presence.online !== true ||
      overview.identity?.environmentId === undefined ||
      overview.logins === undefined ||
      overview.identity.runsWithoutSignIn
    )
      return null;
    const entries = Object.entries(overview.logins);
    if (entries.some(([, login]) => login.present)) return null;
    const entry = entries.find(([id]) => id === "claude-code" || id === "codex");
    if (entry === undefined) return null;
    const agentId = entry[0] as ZeropsAgentId;
    return admissionAttention({
      environmentId: overview.identity.environmentId,
      instanceId: agentId === "claude-code" ? "claudeAgent" : "codex",
      loginKey: agentId,
      agentId,
      cause: "missing-sign-in",
      mateName: key.mateName,
      agentName: "coding agent",
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
  const managedWords = configAuthKind(provider, snapshot, providers) !== null;
  const cliWords =
    providerNeedsSignIn(provider) &&
    (!provider.message ||
      signedOutAgent(provider.message, provider.driver) !== null ||
      /^(?:Not signed in|Not authenticated|Authentication required|Sign in with Google to use Antigravity)/u.test(
        provider.message,
      ));
  if (!managedWords && !cliWords) return provider;
  // Admission owns the auth part even when config also carries a version advisory.
  // Keep that independent evidence without presenting the obsolete auth error again.
  return provider.compatibilityAdvisory?.status === "broken" ||
    provider.compatibilityAdvisory?.status === "unsupported"
    ? { ...provider, status: "ready" as const, message: undefined }
    : null;
}

function configAuthKind(
  provider: {
    readonly instanceId: string;
    readonly message?: string | undefined;
    readonly driver?: string;
  },
  snapshot: ZeropsAgentAuthSnapshot | null,
  providers: ReadonlyArray<{ readonly instanceId: string; readonly driver: string }>,
) {
  const spent = resolveSpentLogin(provider.instanceId, snapshot, providers);
  const agentId =
    spent?.agent.agentId ??
    agentIdForDriverKind(
      provider.driver ?? providers.find((row) => row.instanceId === provider.instanceId)?.driver,
    );
  if (agentId === undefined) return null;
  const login = snapshot?.logins?.find((row) => !row.default && row.id === spent?.key);
  return (
    (["registering", "reconnect", "needs-reauth", "not-authorized"] as const).find(
      (kind) =>
        provider.message ===
        (login === undefined
          ? zeropsAgentUnavailableReason(agentId, kind)
          : zeropsLoginUnavailableReason(login, kind)),
    ) ?? null
  );
}

function providerNeedsSignIn(provider: {
  readonly installed?: boolean;
  readonly auth?: { readonly status: string };
}): boolean {
  return provider.installed === true && provider.auth?.status === "unauthenticated";
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
