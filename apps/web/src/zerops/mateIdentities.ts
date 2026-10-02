/**
 * Who lives in each environment, for the surfaces that show one conversation
 * rather than the account: the Mate's name, its face (a colour and a shape),
 * and the project it belongs to, keyed by the environment the conversation
 * runs in.
 *
 * Read off the candidate list — the one source for names, tags and faces
 * (`hasMate`, `botDisplayName`, `assignCandidateMateTints`, `mateShapeOf`) — by the derived
 * `zeropsMatesAtom` (`useZeropsMates.ts`), so the chat header, an empty
 * conversation and a draft's headline never load anything themselves and can
 * never disagree with the left menu about who a Mate is.
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
  mateShapeOf,
  readZeropsMembership,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import type { EnvironmentId } from "@t3tools/contracts";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";

import type { ZeropsEnvironmentEntry } from "../state/zerops";
import { rowEnvironment } from "./environmentOrigins";

export interface ZeropsMateIdentity {
  /** The exact container behind this environment; absent for a row that names no service. */
  readonly serviceId?: string | undefined;
  readonly name: string;
  readonly tint: MateTintId;
  /** The shape its person picked (HQ's record), else its tint's own — `mateShapeOf`. */
  readonly shape: MateShapeId;
  /** The project the Mate belongs to, as HQ names it; absent for one in no project. */
  readonly project: string | undefined;
  /** The Mate's project on the Zerops dashboard: where a conversation's "Open in Zerops" goes. */
  readonly projectUrl: string;
  /**
   * Whether the Mate's container is connected right now. A Mate is known from
   * its project's tags and its container's origin — seconds before its socket
   * is up — so a surface that draws its face must ask this rather than assume
   * it is awake.
   */
  readonly connected: boolean;
  /**
   * Who asked for the project's development to be stood up (HQ's `standupRequestedBy`), while the
   * ask waits for their first sign-in: their empty conversation says so (`mateStandUp.ts`).
   */
  readonly standUp?: { readonly by: string } | undefined;
  /** Who made it (HQ's `madeBy`): whose sign-in it waits for while nobody has signed it in. */
  readonly madeBy?: string | undefined;
}

const NO_ORIGINS: ReadonlyMap<string, EnvironmentId> = new Map();

export function zeropsMateIdentities(
  candidates: ReadonlyArray<ZeropsCandidate>,
  registeredOrigins: ReadonlyMap<string, EnvironmentId> = NO_ORIGINS,
): ReadonlyMap<EnvironmentId, ZeropsMateIdentity> {
  const tints = assignCandidateMateTints(candidates);
  const mates = new Map<EnvironmentId, ZeropsMateIdentity>();
  for (const candidate of candidates) {
    const environmentId = rowEnvironment(candidate, registeredOrigins);
    if (environmentId === undefined || mates.has(environmentId) || !hasMate(candidate)) continue;
    mates.set(environmentId, zeropsMateIdentityOf(candidate, tints));
  }
  return mates;
}

/**
 * One Mate as its candidate says it, in the tint the account deals it (`assignCandidateMateTints`
 * over every candidate): what `zeropsMateIdentities` keys by environment, for a surface that has
 * the Mate before its environment — its own view while it comes up.
 */
export function zeropsMateIdentityOf(
  candidate: ZeropsCandidate,
  tints: ReadonlyMap<string, MateTintId>,
): ZeropsMateIdentity {
  const tags = readZeropsMembership(candidate.project);
  const tint = tints.get(candidate.project.id) ?? "slate";
  return {
    serviceId: candidate.service?.id,
    name: botDisplayName({ bot: tags.bot, projectName: candidate.project.name }),
    tint,
    shape: mateShapeOf(candidate.project, tint),
    project: tags.label,
    projectUrl: zeropsProjectUrl(candidate.project.id),
    connected: candidate.group === "connected",
    ...(tags.standUp === undefined ? {} : { standUp: tags.standUp }),
    ...(tags.madeBy === undefined ? {} : { madeBy: tags.madeBy }),
  };
}

/** Who lives in one environment: its Mate, nobody, or not known yet. */
export type ZeropsMateAt =
  | { readonly kind: "mate"; readonly mate: ZeropsMateIdentity }
  | { readonly kind: "nobody" }
  | { readonly kind: "unknown" };

/**
 * Who lives in each environment, as far as it is known (DESIGN M4, M5): its Mate, or null where
 * nobody does. An environment it leaves out is not known yet.
 */
export type ZeropsMateDirectory = ReadonlyMap<EnvironmentId, ZeropsMateIdentity | null>;

const NOBODY: ZeropsMateAt = { kind: "nobody" };
const UNKNOWN: ZeropsMateAt = { kind: "unknown" };

export function zeropsMateAt(
  directory: ZeropsMateDirectory,
  environmentId: EnvironmentId,
): ZeropsMateAt {
  const mate = directory.get(environmentId);
  if (mate === undefined) return UNKNOWN;
  return mate === null ? NOBODY : { kind: "mate", mate };
}

/**
 * Who a page draws as living somewhere now: the directory's Mate once read, else — before it is
 * read, a reload's first frames — the one this browser last knew there (`mateIdentityMemory`),
 * so a Mate's page wears its face and name from its first frame. None where nobody lives.
 */
export function knownMate(
  at: ZeropsMateAt,
  remembered: () => ZeropsMateIdentity | undefined,
): ZeropsMateIdentity | undefined {
  if (at.kind === "mate") return at.mate;
  return at.kind === "unknown" ? remembered() : undefined;
}

/**
 * The directory with every environment whose own server says it runs outside
 * Zerops (its descriptor carries no `zerops`) decided: no Mate lives there,
 * whether or not the candidate list has been read. A Zerops environment, or
 * one whose server has not answered yet, waits on a list that reaches it.
 */
export function withEnvironmentsOutsideZerops(
  directory: ZeropsMateDirectory,
  environments: ReadonlyArray<Pick<ZeropsEnvironmentEntry, "environmentId" | "zeropsProjectId">>,
): ZeropsMateDirectory {
  const outside = environments.filter(
    ({ environmentId, zeropsProjectId }) =>
      zeropsProjectId === null && !directory.has(environmentId),
  );
  if (outside.length === 0) return directory;
  const decided = new Map(directory);
  for (const { environmentId } of outside) decided.set(environmentId, null);
  return decided;
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
    const environmentId = rowEnvironment(row, registeredOrigins);
    if (environmentId !== undefined && !decided.has(environmentId))
      decided.set(environmentId, null);
  }
  return decided;
}

/** The question an empty conversation asks: "What should Fen do on Acme Docs?" */
export function mateQuestion(mate: Pick<ZeropsMateIdentity, "name" | "project">): string {
  return mate.project === undefined
    ? `What should ${mate.name} do?`
    : `What should ${mate.name} do on ${mate.project}?`;
}
