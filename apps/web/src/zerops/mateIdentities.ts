/**
 * Who lives in each environment, for the surfaces that show one conversation
 * rather than the account: the Mate's name, its colour, and the project it
 * belongs to, keyed by the environment the conversation runs in.
 *
 * Read off the candidate list — the one source for names, tags and colours
 * (`hasMate`, `botDisplayName`, `assignCandidateMateTints`) — and published by
 * `useZeropsCandidates` next to the environment names, so the chat header, an
 * empty conversation and a draft's headline never load anything themselves
 * and can never disagree with the left menu about who a Mate is.
 *
 * Who lives where is known from the project's tags and the container's
 * origin, not from its socket: `registeredOrigins` maps every registered
 * environment's origin to its id, so a Mate is known the moment the project
 * list is read, seconds before its socket is up.
 */
import {
  assignCandidateMateTints,
  botDisplayName,
  hasMate,
  readZeropsGroupTags,
} from "@t3tools/client-runtime/zerops";
import { normalizeOrigin, type ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import type { EnvironmentId } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";

export interface ZeropsMateIdentity {
  /** The exact container behind this environment; older cached identities may not know it. */
  readonly serviceId?: string | undefined;
  readonly name: string;
  readonly tint: MateTintId;
  /** The project the Mate belongs to, as its label tag reads; absent for one in no project. */
  readonly project: string | undefined;
  /** The Mate's project on the Zerops dashboard: where a conversation's "Open in Zerops" goes. */
  readonly projectUrl: string;
  /**
   * Whether the Mate's container is connected right now. A Mate is known from
   * its project's tags and its container's origin — seconds before its socket
   * is up, and from the last reload's cache on the first frame — so a surface
   * that draws its face must ask this rather than assume it is awake.
   */
  readonly connected: boolean;
}

const NO_ORIGINS: ReadonlyMap<string, EnvironmentId> = new Map();

export function zeropsMateIdentities(
  candidates: ReadonlyArray<ZeropsCandidate>,
  registeredOrigins: ReadonlyMap<string, EnvironmentId> = NO_ORIGINS,
): ReadonlyMap<EnvironmentId, ZeropsMateIdentity> {
  const tints = assignCandidateMateTints(candidates);
  const mates = new Map<EnvironmentId, ZeropsMateIdentity>();
  for (const candidate of candidates) {
    const environmentId =
      candidate.environmentId ?? registeredEnvironment(candidate, registeredOrigins);
    if (environmentId === undefined || mates.has(environmentId) || !hasMate(candidate)) continue;
    const tags = readZeropsGroupTags(candidate.project.tagList);
    mates.set(environmentId, {
      serviceId: candidate.service?.id,
      name: botDisplayName({ bot: tags.bot, projectName: candidate.project.name }),
      tint: tints.get(candidate.project.id) ?? "slate",
      project: tags.label,
      projectUrl: zeropsProjectUrl(candidate.project.id),
      connected: candidate.group === "connected",
    });
  }
  return mates;
}

/** Who lives in one environment: its Mate, nobody, or not known yet. */
export type ZeropsMateAt =
  | { readonly kind: "mate"; readonly mate: ZeropsMateIdentity }
  | { readonly kind: "nobody" }
  | { readonly kind: "unknown" };

/**
 * Who lives in each environment, as far as the candidate list has been read
 * (DESIGN M4, M5): an answer per environment a read row reaches, and whether
 * a list read in full has said that nobody lives anywhere else.
 */
export interface ZeropsMateDirectory {
  /** Each environment a read row reaches: its Mate, or null where the row holds none. */
  readonly decided: ReadonlyMap<EnvironmentId, ZeropsMateIdentity | null>;
  /** Every environment `decided` leaves out holds nobody; otherwise it is not known yet. */
  readonly complete: boolean;
}

/** A directory before any list has been read: nobody's whereabouts are known. */
export const MATES_UNREAD: ZeropsMateDirectory = { decided: new Map(), complete: false };

const NOBODY: ZeropsMateAt = { kind: "nobody" };
const UNKNOWN: ZeropsMateAt = { kind: "unknown" };

export function zeropsMateAt(
  directory: ZeropsMateDirectory,
  environmentId: EnvironmentId,
): ZeropsMateAt {
  const mate = directory.decided.get(environmentId);
  if (mate !== undefined) return mate === null ? NOBODY : { kind: "mate", mate };
  return directory.complete ? NOBODY : UNKNOWN;
}

/**
 * The environments these rows decide: each Mate `zeropsMateIdentities` finds,
 * and nobody in every other environment a row whose presence is read reaches.
 * A row whose presence is not read decides nothing.
 */
export function zeropsMateDecisions(
  rows: ReadonlyArray<CandidateRow>,
  registeredOrigins: ReadonlyMap<string, EnvironmentId> = NO_ORIGINS,
): ReadonlyMap<EnvironmentId, ZeropsMateIdentity | null> {
  const decided = new Map<EnvironmentId, ZeropsMateIdentity | null>(
    zeropsMateIdentities(rows, registeredOrigins),
  );
  for (const row of rows) {
    if (row.presence !== "known") continue;
    const environmentId = row.environmentId ?? registeredEnvironment(row, registeredOrigins);
    if (environmentId !== undefined && !decided.has(environmentId))
      decided.set(environmentId, null);
  }
  return decided;
}

/** The Mates a directory knows of, as the reload cache keeps them. */
export function zeropsMatesOf(
  directory: ZeropsMateDirectory,
): ReadonlyMap<EnvironmentId, ZeropsMateIdentity> {
  const mates = new Map<EnvironmentId, ZeropsMateIdentity>();
  for (const [environmentId, mate] of directory.decided) {
    if (mate !== null) mates.set(environmentId, mate);
  }
  return mates;
}

function registeredEnvironment(
  candidate: ZeropsCandidate,
  registeredOrigins: ReadonlyMap<string, EnvironmentId>,
): EnvironmentId | undefined {
  const origin = candidate.containerOrigin;
  if (origin === undefined) return undefined;
  return registeredOrigins.get(normalizeOrigin(origin) ?? origin);
}

/** The question an empty conversation asks: "What should Fen do on Acme Docs?" */
export function mateQuestion(mate: ZeropsMateIdentity): string {
  return mate.project === undefined
    ? `What should ${mate.name} do?`
    : `What should ${mate.name} do on ${mate.project}?`;
}
