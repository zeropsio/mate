/**
 * Who lives in each environment, for the surfaces that show one conversation
 * rather than the account: the Mate's name, its colour, and the project it
 * belongs to, keyed by the environment the conversation runs in.
 *
 * Read off the candidate list — the one source for names, tags and colours
 * (`hasMate`, `botDisplayName`, `assignCandidateMateTints`) — by the derived
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
  readZeropsGroupTags,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import type { EnvironmentId } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";

import type { ZeropsEnvironmentEntry } from "../state/zerops";
import { rowEnvironment } from "./environmentOrigins";

export interface ZeropsMateIdentity {
  /** The exact container behind this environment; absent for a row that names no service. */
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
   * is up — so a surface that draws its face must ask this rather than assume
   * it is awake.
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
    const environmentId = rowEnvironment(candidate, registeredOrigins);
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
export function mateQuestion(mate: ZeropsMateIdentity): string {
  return mate.project === undefined
    ? `What should ${mate.name} do?`
    : `What should ${mate.name} do on ${mate.project}?`;
}
