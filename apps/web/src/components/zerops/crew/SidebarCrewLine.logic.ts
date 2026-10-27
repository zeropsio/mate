/**
 * A crew as one line under its Mate in the left menu (pass 16, M14): every
 * crewmate's face, the lead first, and the crew's one most urgent fact — who
 * needs you, or whose finished work waits for your review, or nothing.
 *
 * Read from the crew's digest in its Mate's overview (`@t3tools/shared/mateLink`), as HQ hands it
 * on — the same for a Mate nobody opened as for the open one. Every word comes from
 * `crew/phrases.ts` (R5); a face's state is its chat's kind, through the one mapping
 * (`mateMarkStateForThreadStatus`).
 */
import {
  agentOwnershipAllowsTurns,
  resolveAgentOwnership,
} from "@t3tools/client-runtime/zerops/agentOwnership";
import { crewLineNeedsWord, crewLineReadyWord } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { ThreadId } from "@t3tools/contracts";
import { MATE_TINT_IDS, type MateMarkState, type MateTintId } from "@t3tools/shared/brand";
import type { CrewDigest, OverviewLogins } from "@t3tools/shared/mateLink";
import { mateMarkStateForThreadStatus } from "@t3tools/shared/threadStatus";

export interface CrewLineFace {
  readonly handle: string;
  readonly displayName: string;
  readonly tint: MateTintId;
  /** Its chat's face; idle before its first turn. */
  readonly state: MateMarkState;
  /** Its chat, which the face opens; `null` before its first turn. */
  readonly threadId: ThreadId | null;
  readonly lead: boolean;
}

export type CrewLineFact =
  /** Crewmates wait on the person: a question, an approval, a plan, a stop to decide. */
  | { readonly kind: "needs"; readonly words: string }
  /** Finished work waits for the person's review; *Review* opens the first. */
  | { readonly kind: "land"; readonly words: string; readonly taskId: string };

/** A crewmate's tint as this build draws it: one it does not know is the first. */
const tintOf = (tint: string): MateTintId =>
  MATE_TINT_IDS.find((id) => id === tint) ?? MATE_TINT_IDS[0];

/**
 * Every crewmate's face, the lead first, each in its chat's kind. Under another's Mate
 * (`mine` false) no face needs the viewer: the crew waits on its owner.
 */
export function crewFaces(crew: CrewDigest, mine: boolean): ReadonlyArray<CrewLineFace> {
  return crew.crewmates.map((mate): CrewLineFace => {
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

export function crewLine(
  crew: CrewDigest,
  /**
   * Its Mate is the viewer's own (HQ's `waitsOnViewer`). Under another's Mate the crew waits on its
   * owner: no face needs the viewer and the line never says so — its finished work still offers
   * its Review, for anybody with write on the group.
   */
  mine: boolean,
): { readonly faces: ReadonlyArray<CrewLineFace>; readonly fact: CrewLineFact | null } {
  const faces = crewFaces(crew, mine);
  // Who needs you: a crewmate whose face says so, or whom the crew's
  // *Waiting on you* list names for anything but a task ready to land — that
  // one is the next fact's. In the crew's own order, the lead first.
  const waiting = new Set(
    crew.attention.flatMap((row) =>
      !mine || row.handle === null || row.kind === "ready-to-land" ? [] : [row.handle],
    ),
  );
  const needs = faces.filter((face) => face.state === "needs" || waiting.has(face.handle));
  if (needs.length > 0) {
    return {
      faces,
      fact: { kind: "needs", words: crewLineNeedsWord(needs.map((face) => face.displayName)) },
    };
  }
  // Finished work waits for your review while the crew does not put it in
  // itself (`crewPersonLands`): no run on, or a run that waits for you.
  const ready = crew.personLands ? crew.readyTasks : [];
  const first = ready[0];
  const nameOf = (handle: string) =>
    crew.crewmates.find((mate) => mate.handle === handle)?.displayName ?? handle;
  return {
    faces,
    fact:
      first === undefined
        ? null
        : {
            kind: "land",
            words: crewLineReadyWord(ready.map((task) => nameOf(task.owner))),
            taskId: first.id,
          },
  };
}

/**
 * Whether a task's review is the viewer's to open from the line: its crewmate's login is theirs to
 * run, read as `crewLoginLock` reads it (`crewAccess.ts`) — a project token's or one with no
 * credential is anybody's, a person's sign-in only its signer's — from the Mate's overview: its
 * crewmates' logins and whose each is.
 */
export function crewTaskReviewable(
  crew: Pick<CrewDigest, "crewmates" | "readyTasks">,
  logins: OverviewLogins,
  viewerSubject: string | undefined,
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
