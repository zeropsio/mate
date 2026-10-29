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
  RunEnd,
} from "@t3tools/contracts";
import { agentIdForDriverKind, agentIdForProviderInstance } from "@t3tools/contracts";
import type { Known } from "../../zerops/knowledge/index.ts";
import { resolveSpentLogin } from "../../zerops/logins.ts";
import { signedOutAgent } from "../../zerops/agentSignIn.ts";
import { MATE_READ_ACCESS_LINE } from "../../zerops/mateAccess.ts";
import {
  classifyZeropsAgentAuth,
  zeropsAgentUnavailableReason,
  zeropsLoginUnavailableReason,
  zeropsLoginTitle,
} from "@t3tools/shared/zeropsAgentAuth";
import { zeropsAgentSignInRequired } from "../../zerops/agentLogin.ts";
import {
  zeropsAgentAvailabilityIsRunnable,
  zeropsAgentAuthReads,
  zeropsLoginAuthReads,
  resolveZeropsAgentAvailability,
  type ZeropsAgentAvailability,
  type ZeropsAgentAuthRead,
} from "../../zerops/agentAvailability.ts";
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

/**
 * No coding agent can act here — none signed in, none outside the sign-in ready — once the agents'
 * sign-in is read: an empty conversation holds its composer for the sign-in (`holdsComposer`), and
 * a Chief's empty draft shows the sign-in in its question's place.
 */
export function admissionNeedsSignIn(
  read: Known<ZeropsAgentAuthSnapshot> | undefined,
  providers: ReadonlyArray<ServerProvider>,
): boolean {
  const snapshot = read?.state === "known" ? read.value : null;
  return snapshot !== null && zeropsAgentSignInRequired(snapshot, providers);
}

/**
 * Whether the viewer only reads along: a colleague's Mate as HQ records it, or a project they may
 * not operate. Admission's read-only, without its auth read.
 */
export function readsAlong(input: {
  readonly operate?: boolean | undefined;
  readonly owner?: { readonly mine: boolean } | null | undefined;
}): boolean {
  return input.owner?.mine === false || input.operate === false;
}

/** Auth establishes admission; a signer's identity establishes no client permission. */
export function agentAdmission(input: {
  readonly environmentId: string;
  readonly instanceId: string | undefined;
  readonly viewerSubject: string | undefined;
  readonly read: Known<ZeropsAgentAuthSnapshot> | undefined;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly mateName: string;
  /** Native project permission, from platformCapabilities; absent outside Zerops projects. */
  readonly operate?: boolean | undefined;
  readonly refusalSource?: AgentAdmissionRefusal | undefined;
  readonly empty?: boolean;
  readonly standUpHolds?: boolean;
  /**
   * Whose Mate it is as HQ records it (its owner against the viewer), never as a signer says: a
   * colleague's Mate is read along, its composer and its sign-in its owner's (the owner,
   * 2026-10-12: "this mate is not mine and I can still see the composer"). Absent while HQ names
   * nobody (`null`); unresolved while HQ has not said (`undefined`).
   */
  readonly owner?: { readonly mine: boolean } | null | undefined;
  /**
   * An automated Mate: its agents run on the organization's key, never a person's sign-in — it
   * raises no sign-in and holds its composer for none; with no agent it can run, its composer
   * says it waits for the organization's API key (`automatedAgentUsable`).
   */
  readonly automated?: boolean | undefined;
}) {
  if (input.automated === true) return automatedAdmission(input);
  const readOnly = readsAlong(input);
  const snapshot = input.read?.state === "known" ? input.read.value : null;
  const provider = input.providers.find((p) => p.instanceId === input.instanceId) ?? null;
  const spent = resolveSpentLogin(input.instanceId, snapshot, input.providers);
  const login = snapshot?.logins?.find((row) => !row.default && row.id === spent?.key);
  const cold =
    input.owner === undefined || input.read?.state === "unread" || input.read?.state === "reading";
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
    readOnly || cause === null || input.instanceId === undefined
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
  const needsSignIn = input.empty === true && admissionNeedsSignIn(input.read, input.providers);
  const holdsComposer = input.standUpHolds === true || needsSignIn;
  const refusal = input.operate === false ? MATE_READ_ACCESS_LINE : (attention?.text ?? null);
  const held =
    readOnly || cold
      ? null
      : input.standUpHolds === true
        ? standUpHoldReason(input.mateName)
        : needsSignIn
          ? `Sign ${input.mateName} in to start.`
          : null;
  return {
    attention,
    providerStatus: admissionProviderStatus(provider, snapshot, input.providers),
    explainsRefusal: admissionExplainsRefusal(attention, input.refusalSource),
    footer: readOnly ? ("read-only" as const) : cold ? ("held" as const) : ("composer" as const),
    canSend: !readOnly && !cold && !holdsComposer && attention === null,
    // A send that cannot go says why, Send and Enter alike: the composer refuses on it.
    sendBlockReason: refusal ?? held,
    // Held a moment — its agents' sign-in still read, or its person's stand-up on its way — a send
    // goes by itself once that is over: a request waits for it (`composerAdmits`).
    sendWaits: refusal === null && !readOnly && (cold || input.standUpHolds === true),
    // Signer records establish no client permission, including compact HQ records; HQ's recorded
    // owner does.
    readOnly,
    holdsComposer,
  };
}

/** Why a composer its person's stand-up holds takes no message yet. */
const standUpHoldReason = (mateName: string) =>
  `${mateName} is standing up development. You can write once it has started.`;

/** An agent an automated Mate can run: one no person signs in to, on and ready. */
export function automatedAgentUsable(providers: ReadonlyArray<ServerProvider>): boolean {
  return providers.some(
    (provider) =>
      agentIdForDriverKind(provider.driver) === undefined &&
      provider.enabled &&
      provider.installed &&
      (provider.status === "ready" || provider.status === "warning"),
  );
}

/** `agentAdmission` for an automated Mate: nobody signs it in; the organization's key runs it. */
function automatedAdmission(input: Parameters<typeof agentAdmission>[0]) {
  const readOnly = readsAlong(input);
  const cold = input.owner === undefined;
  const usable = automatedAgentUsable(input.providers);
  const holdsComposer = input.standUpHolds === true;
  // A subscription agent's status (its sign-in) is nothing of this Mate's: none is said.
  const found = input.providers.find((p) => p.instanceId === input.instanceId) ?? null;
  const provider = agentIdForDriverKind(found?.driver) === undefined ? found : null;
  const snapshot = input.read?.state === "known" ? input.read.value : null;
  const refusal =
    input.operate === false
      ? MATE_READ_ACCESS_LINE
      : usable
        ? null
        : `${input.mateName} waits for your organization's API key.`;
  return {
    attention: null,
    providerStatus: admissionProviderStatus(provider, snapshot, input.providers),
    explainsRefusal: false,
    footer: readOnly ? ("read-only" as const) : cold ? ("held" as const) : ("composer" as const),
    canSend: !readOnly && !cold && !holdsComposer && usable,
    sendBlockReason:
      refusal ?? (holdsComposer && !readOnly && !cold ? standUpHoldReason(input.mateName) : null),
    sendWaits: refusal === null && !readOnly && (cold || holdsComposer),
    readOnly,
    holdsComposer,
  };
}

export type AgentRefusalSource = AgentAdmissionRefusal;

/** The latest engine run's refusal, by its login: it joins the selected login as a command's did. */
export function engineRunRefusal(
  runs: ReadonlyArray<{ readonly ordinal: number; readonly end: RunEnd | null }> | undefined,
): AgentAdmissionRefusal | undefined {
  const latest = runs?.reduce<(typeof runs)[number] | undefined>(
    (a, b) => (a === undefined || b.ordinal > a.ordinal ? b : a),
    undefined,
  );
  const admission = latest?.end?.kind === "failed" ? latest.end.admission : undefined;
  return admission === undefined || admission.reason === "unknown"
    ? undefined
    : { loginId: admission.loginId, reason: admission.reason };
}

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
    // An automated Mate's agents run on the organization's key: nobody is asked to sign it in.
    const placed = read.fact("placement", key.projectId);
    if (placed.kind === "known" && placed.value.mate?.automated === true) return null;
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

/** Web selection follows scoped auth; command permission remains the server's decision. */
export function resolveZeropsProviderAvailability(input: {
  readonly entries: ReadonlyArray<{
    readonly instanceId: ProviderInstanceId;
    readonly driverKind: string;
  }>;
  readonly agentAuth: Known<ZeropsAgentAuthSnapshot> | undefined;
}): ReadonlyMap<ProviderInstanceId, ZeropsAgentAvailability> | undefined {
  if (input.agentAuth === undefined) return undefined;
  // Native availability retains its existing ownership path; web consumes auth facts only.
  const factsOf = (agent: ZeropsAgentAuthSnapshot["agents"][number]) => ({
    credPresent: agent.credPresent,
    flagToken: agent.flagToken,
    providerAuth: agent.providerAuth,
    verification: agent.verification,
    registration: agent.registration,
    state: agent.state,
    loginPhase: agent.login?.phase,
  });
  const reads = zeropsAgentAuthReads(input.agentAuth, factsOf);
  if (reads === undefined) return undefined;
  // A login beyond the defaults answers for itself, as the server's admission
  // resolves it; until the feed is known, its driver's agent says `unknown`
  // for it like for every other instance.
  const loginReads = zeropsLoginAuthReads(input.agentAuth, factsOf);
  const map = new Map<ProviderInstanceId, ZeropsAgentAvailability>();
  const authentication = (agent: ZeropsAgentAuthRead): ZeropsAgentAvailability => {
    if (agent.state !== "known") return { kind: "unknown", read: agent };
    const auth = classifyZeropsAgentAuth(agent.value).kind;
    if (auth === "authorized") return { kind: "ready" };
    if (auth === "registering") return { kind: "registering" };
    return resolveZeropsAgentAvailability({ agent, viewerSubject: undefined });
  };
  for (const entry of input.entries) {
    const login = loginReads(entry.instanceId);
    if (login !== undefined) {
      map.set(entry.instanceId, authentication(login));
      continue;
    }
    const agentId = agentIdForDriverKind(entry.driverKind);
    if (agentId === undefined) continue;
    const agent = reads(agentId);
    if (agent === undefined) continue;
    map.set(entry.instanceId, authentication(agent));
  }
  return map;
}

/** Unknown auth holds the initial composer without changing the selected login. */
export function isZeropsInstanceRunnable(
  availabilityByInstanceId: ReadonlyMap<ProviderInstanceId, ZeropsAgentAvailability> | undefined,
  instanceId: ProviderInstanceId,
): boolean {
  const availability = availabilityByInstanceId?.get(instanceId);
  return (
    availability === undefined ||
    availability.kind === "unknown" ||
    zeropsAgentAvailabilityIsRunnable(availability)
  );
}
