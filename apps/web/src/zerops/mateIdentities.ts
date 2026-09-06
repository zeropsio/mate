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
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import type { EnvironmentId } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";

export interface ZeropsMateIdentity {
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
      name: botDisplayName({ bot: tags.bot, projectName: candidate.project.name }),
      tint: tints.get(candidate.project.id) ?? "slate",
      project: tags.label,
      projectUrl: zeropsProjectUrl(candidate.project.id),
      connected: candidate.group === "connected",
    });
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
