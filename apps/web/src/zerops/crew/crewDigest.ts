/**
 * What a Mate's crew is, read from its digest in the Mate's overview (`@t3tools/shared/mateLink`)
 * as HQ hands it on — the same for a Mate nobody opened as for the open one: each crewmate's face,
 * and whether a ready task's review is the viewer's to open. The menu's mini Mates, the
 * conversation's strip and what needs the viewer (`needsYou`) read these.
 */
import {
  agentOwnershipAllowsTurns,
  resolveAgentOwnership,
} from "@t3tools/client-runtime/zerops/agentOwnership";
import type { ThreadId, ZeropsUserId } from "@t3tools/contracts";
import { MATE_TINT_IDS, type MateMarkState, type MateTintId } from "@t3tools/shared/brand";
import type { CrewDigest, OverviewLogins } from "@t3tools/shared/mateLink";
import { mateMarkStateForThreadStatus } from "@t3tools/shared/threadStatus";

export interface CrewDigestFace {
  readonly handle: string;
  readonly displayName: string;
  readonly tint: MateTintId;
  /** Its chat's face; idle before its first turn. */
  readonly state: MateMarkState;
  /** Its chat, which the face opens; `null` before its first turn. */
  readonly threadId: ThreadId | null;
  readonly lead: boolean;
}

/** A crewmate's tint as this build draws it: one it does not know is the first. */
const tintOf = (tint: string): MateTintId =>
  MATE_TINT_IDS.find((id) => id === tint) ?? MATE_TINT_IDS[0];

/**
 * Every crewmate's face, in the crew's order, each in its chat's kind (the one mapping,
 * `mateMarkStateForThreadStatus`). Under another's Mate (`mine` false) no face needs the viewer:
 * the crew waits on its owner.
 */
export function crewFaces(crew: CrewDigest, mine: boolean): ReadonlyArray<CrewDigestFace> {
  return crew.crewmates.map((mate): CrewDigestFace => {
    const state = mate.threadKind === null ? "idle" : mateMarkStateForThreadStatus(mate.threadKind);
    return {
      handle: mate.handle,
      displayName: mate.displayName,
      tint: tintOf(mate.tint),
      state: !mine && state === "needs" ? "idle" : state,
      threadId: mate.threadId,
      lead: mate.lead,
    };
  });
}

/**
 * Whether a task's review is the viewer's to open: its crewmate's login is theirs to run, read as
 * `crewLoginLock` reads it (`crewAccess.ts`) — a project token's or one with no credential is
 * anybody's, a person's sign-in only its signer's — from the Mate's overview: its crewmates'
 * logins and whose each is.
 */
export function crewTaskReviewable(
  crew: Pick<CrewDigest, "crewmates" | "readyTasks">,
  logins: OverviewLogins,
  viewerSubject: ZeropsUserId | undefined,
): (taskId: string) => boolean {
  return (taskId) => {
    const owner = crew.readyTasks.find((task) => task.id === taskId)?.owner;
    const key = crew.crewmates.find((mate) => mate.handle === owner)?.loginKey ?? null;
    const login = key === null ? undefined : logins[key];
    if (login === undefined || login.token) return true;
    return agentOwnershipAllowsTurns(
      resolveAgentOwnership({
        credPresent: login.present,
        authorizedBy: login.signedInBy === null ? undefined : { subject: login.signedInBy },
        viewerSubject,
      }),
    );
  };
}
