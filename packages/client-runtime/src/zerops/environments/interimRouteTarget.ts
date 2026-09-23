/**
 * The route target as today's shell can tell it (DESIGN §4.8, the 0.9c interim): the environment
 * machine's regions read off what the web app already holds — the catalog's registration and its
 * connection phase, the remembered target record, the inventory's candidates and the identity
 * exchanges in flight — and projected through `selectReachability`, the one verdict.
 *
 * The exchange driver's machine per target replaces this module once the web app runs it; until
 * then it knows no backoff, refusal, descriptor or redeploy, so it never says `retrying`,
 * `refused-role`, `update-*` or `replaced`, and it never says `gone`: absence without a direct
 * read is not evidence (§3.1). Before the descriptor sweep (3.3), an environment nothing here
 * names is "not in your projects" only once the inventory is known and no exchange that could
 * name it is still running.
 */
import type { EnvironmentId } from "@t3tools/contracts";

import type { EnvironmentConnectionPhase } from "../../connection/presentation.ts";
import { normalizeOrigin, type ZeropsCandidate } from "../candidates.ts";
import {
  initialEnvironment,
  type ContainerVerdict,
  type Credential,
  type LinkPhase,
  type Presence,
  type ServiceTransition,
} from "./environmentMachine.ts";
import type { RouteContent, RouteTarget } from "./gate.ts";
import { interimContainerVerdict } from "./interimContainer.ts";
import { selectReachability, type Reachability } from "./reachability.ts";

/** The catalog's entry for the environment. */
export interface InterimRegistration {
  /** Where the entry was registered; null when it names no origin. */
  readonly origin: string | null;
  readonly connection: EnvironmentConnectionPhase;
}

export interface InterimTargetInput {
  readonly environmentId: EnvironmentId;
  /** The catalog's entry for this environment; null when the catalog holds none. */
  readonly registration: InterimRegistration | null;
  /** The target key (`projectId:serviceId`) remembered for this environment; null when none. */
  readonly recordKey: string | null;
  /** Every candidate the inventory derives; null while the inventory is not known. */
  readonly candidates: ReadonlyArray<ZeropsCandidate> | null;
  /** Whether an identity exchange is in flight for an origin. */
  readonly exchangePending: (origin: string) => boolean;
}

export interface InterimRouteInput extends InterimTargetInput {
  /** The shell's restore of remembered targets still has attempts running. */
  readonly restoring: boolean;
  readonly organization: "chosen" | "choosing" | "not-chosen";
  readonly content: RouteContent;
}

const TRANSITIONS: ReadonlySet<string> = new Set<ServiceTransition>([
  "NEW",
  "CREATING",
  "STARTING",
  "RESTARTING",
  "UPGRADING",
]);

/** The exchange's own deadline is the shell's business; the interim never times it out. */
const UNTIMED = { wall: Number.POSITIVE_INFINITY, mono: Number.POSITIVE_INFINITY };

/**
 * The candidate for the target: by the remembered key, by the project a project-level candidate
 * stands in for (a project that is not up, or whose services could not be read), or by the
 * registration's origin.
 */
function findCandidate(input: InterimTargetInput): ZeropsCandidate | undefined {
  const { candidates, recordKey, registration } = input;
  if (candidates === null) return undefined;
  if (recordKey !== null) {
    const projectId = recordKey.split(":")[0];
    const byKey =
      candidates.find((candidate) => candidate.key === recordKey) ??
      candidates.find(
        (candidate) =>
          candidate.key === projectId &&
          candidate.service === undefined &&
          candidate.missingContainer !== true,
      );
    if (byKey !== undefined) return byKey;
  }
  const origin = registration?.origin == null ? null : normalizeOrigin(registration.origin);
  return origin === null
    ? undefined
    : candidates.find(
        (candidate) =>
          candidate.containerOrigin !== undefined &&
          normalizeOrigin(candidate.containerOrigin) === origin,
      );
}

/**
 * Region P. An ACTIVE service without an origin stays unknown: the candidate names why only in
 * prose, and the presence region that reads the service's facets lands with the container machine.
 */
function presenceOf(candidate: ZeropsCandidate | undefined): Presence {
  if (candidate === undefined) return { kind: "unknown" };
  const status = candidate.service?.status ?? candidate.project.status;
  if (status === "ACTIVE") {
    return candidate.service !== undefined && candidate.containerOrigin !== undefined
      ? { kind: "present", origin: candidate.containerOrigin }
      : { kind: "unknown" };
  }
  return TRANSITIONS.has(status)
    ? { kind: "transitioning", status: status as ServiceTransition }
    : { kind: "inactive", status };
}

/** Region L from the catalog's connection presentation, which keeps no block reason. */
function linkOf(registration: InterimRegistration | null): LinkPhase {
  switch (registration?.connection) {
    case undefined:
    case "available":
      return { phase: "idle" };
    case "offline":
      return { phase: "offline" };
    case "connecting":
    case "reconnecting":
      return { phase: "connecting" };
    case "connected":
      return { phase: "connected" };
    case "error":
      // A block the interim cannot re-read reads as a link that is down (§4.4 row 10).
      return { phase: "backoff", retryAtMs: null };
  }
}

/** Region K: a registration holds a credential; otherwise an exchange is running or none is. */
function credentialOf(
  input: InterimTargetInput,
  candidate: ZeropsCandidate | undefined,
): Credential {
  if (input.registration !== null) {
    return {
      kind: "held",
      environmentId: input.environmentId,
      staleBlock: false,
      rereading: null,
    };
  }
  const origin = candidate?.containerOrigin;
  return origin !== undefined && input.exchangePending(origin)
    ? { kind: "exchanging", attempt: 0, deadline: UNTIMED, reconnect: false }
    : { kind: "none", reconnect: false };
}

/**
 * The environment's reachability, or null when nothing today's shell holds names its target: no
 * registration, and no remembered record whose target the known inventory still lists.
 */
export function interimReachability(input: InterimTargetInput): Reachability | null {
  const candidate = findCandidate(input);
  const named =
    input.registration !== null ||
    (input.recordKey !== null && (input.candidates === null || candidate !== undefined));
  if (!named) return null;
  const link = linkOf(input.registration);
  const container: ContainerVerdict =
    candidate === undefined
      ? { level: "unknown" }
      : interimContainerVerdict({ candidate, health: undefined, mateFlag: undefined });
  return selectReachability(
    {
      ...initialEnvironment({ record: input.recordKey === null ? null : input.environmentId }),
      presence: presenceOf(candidate),
      credential: credentialOf(input, candidate),
      link: link.phase === "connected" ? { phase: "connected", since: { wall: 0, mono: 0 } } : link,
      container,
    },
    input.environmentId,
  );
}

/** The gate's target for the route's environment. */
export function interimRouteTarget(input: InterimRouteInput): RouteTarget {
  const reachability = interimReachability(input);
  if (reachability !== null) return { kind: "resolved", reachability, content: input.content };
  if (input.organization === "not-chosen") {
    return { kind: "unresolved", discovery: "no-organization" };
  }
  const discovering =
    input.organization === "choosing" ||
    input.candidates === null ||
    input.restoring ||
    input.candidates.some(
      (candidate) =>
        candidate.containerOrigin !== undefined && input.exchangePending(candidate.containerOrigin),
    );
  return { kind: "unresolved", discovery: discovering ? "pending" : "settled" };
}
