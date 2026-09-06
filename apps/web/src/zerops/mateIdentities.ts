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
 */
import {
  assignCandidateMateTints,
  botDisplayName,
  hasMate,
  readZeropsGroupTags,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { EnvironmentId } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";

export interface ZeropsMateIdentity {
  readonly name: string;
  readonly tint: MateTintId;
  /** The project the Mate belongs to, as its label tag reads; absent for one in no project. */
  readonly project: string | undefined;
}

export function zeropsMateIdentities(
  candidates: ReadonlyArray<ZeropsCandidate>,
): ReadonlyMap<EnvironmentId, ZeropsMateIdentity> {
  const tints = assignCandidateMateTints(candidates);
  const mates = new Map<EnvironmentId, ZeropsMateIdentity>();
  for (const candidate of candidates) {
    const environmentId = candidate.environmentId;
    if (environmentId === undefined || mates.has(environmentId) || !hasMate(candidate)) continue;
    const tags = readZeropsGroupTags(candidate.project.tagList);
    mates.set(environmentId, {
      name: botDisplayName({ bot: tags.bot, projectName: candidate.project.name }),
      tint: tints.get(candidate.project.id) ?? "slate",
      project: tags.label,
    });
  }
  return mates;
}

/** The question an empty conversation asks: "What should Fen do on Acme Docs?" */
export function mateQuestion(mate: ZeropsMateIdentity): string {
  return mate.project === undefined
    ? `What should ${mate.name} do?`
    : `What should ${mate.name} do on ${mate.project}?`;
}
