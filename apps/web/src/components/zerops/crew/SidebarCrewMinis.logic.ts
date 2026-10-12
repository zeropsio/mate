/**
 * A crew as mini Mates after its Mate's name in the left menu, like ducklings (the owner,
 * 2026-10-12: "crew can have like mini mates somewhere with some fun effect"): every crewmate's
 * face in its state — the ones that need the viewer first, then the lead, then the crew's order —
 * the crew's one fact that needs the viewer, risen into its Mate's own line, and the finished
 * work the viewer may land, for the project's Review tag. A crew never adds a line to its Mate.
 *
 * Read from the crew's digest in its Mate's overview (`@t3tools/shared/mateLink`), as HQ hands it
 * on — the same for a Mate nobody opened as for the open one. Every word comes from
 * `crew/phrases.ts` (R5); a face's state is its chat's kind, through the one mapping
 * (`crewFaces`).
 */
import {
  CREW_MINI_NEEDS_WORD,
  crewLineNeedsWord,
  crewLineReadyWord,
  crewMiniDoingWord,
  crewRowWords,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewStatus, EnvironmentId } from "@t3tools/contracts";
import { MATE_SHAPE_OF_TINT, type MateShapeId, type MateTintId } from "@t3tools/shared/brand";
import type { CrewDigest, OverviewLogins } from "@t3tools/shared/mateLink";

import { crewFaces, crewTaskReviewable } from "./SidebarCrewLine.logic";

/**
 * A crew handed to the menu instead of HQ's (a harness): its status for the Mate's menu, its
 * digest for the minis, whose its logins are, and — for its Review items — the Mate's
 * environment.
 */
export interface SidebarCrewRead {
  readonly status: CrewStatus | null;
  readonly crew: CrewDigest | null;
  readonly logins: OverviewLogins;
  readonly environmentId?: EnvironmentId | undefined;
}

/** What a Mate's crew row is read from: HQ's view of it (`MateCrewRead`) or a fixture's. */
export interface CrewRowRead {
  readonly crew: CrewDigest | null;
  readonly logins: OverviewLogins;
  /** What the crew does is HQ's answer now; otherwise its faces stand at rest. */
  readonly current: boolean;
  /** The Mate's environment, where its crew's review opens. */
  readonly environmentId: EnvironmentId | undefined;
  /** Its Mate is the viewer's own (HQ's `waitsOnViewer`): only then does the crew need them. */
  readonly mine: boolean;
  /** Who is looking, for whose a crewmate's login is. */
  readonly viewerSubject: string | undefined;
}

export interface CrewMini {
  /** The crewmate's handle. */
  readonly id: string;
  readonly name: string;
  readonly lead: boolean;
  readonly tint: MateTintId;
  readonly shape: MateShapeId;
  /** As its face stands: at work, asking the viewer, or at rest. */
  readonly state: "working" | "needs" | "idle";
  /** What it is doing or asks, for its tooltip. */
  readonly doing: string | undefined;
}

export interface CrewReviewItem {
  /** `crew:<environmentId>:<taskId>` */
  readonly key: string;
  readonly target: {
    readonly kind: "crew-task";
    readonly environmentId: EnvironmentId;
    readonly taskId: string;
  };
  readonly title: string;
  readonly crewmate: {
    readonly name: string;
    readonly tint: MateTintId;
    readonly shape: MateShapeId;
  };
}

export interface CrewRowFacts {
  /** Up to 4 shown whole, the rest as "+N" (5 or fewer: all whole). */
  readonly minis: ReadonlyArray<CrewMini>;
  readonly more: number;
  /**
   * Whether the states are read now: otherwise they stand at rest from memory, and a change is
   * no arrival to greet.
   */
  readonly known: boolean;
  /** The crew's fact that needs the viewer, for its Mate's second line; only under their own Mate. */
  readonly need:
    | { readonly kind: "ask" | "land"; readonly crewmate: string; readonly words: string }
    | undefined;
  /** Finished work the viewer may land from here, for the project's Review tag. */
  readonly reviews: ReadonlyArray<CrewReviewItem>;
  /** The crew's whole state in words, for the Mate row's accessible name. */
  readonly words: string;
}

/** How many crewmates are drawn whole at most; past one more, the rest fold into "+N". */
const WHOLE = 4;

/** Every fact of a Mate's crew the menu draws; nothing without a crew. */
export function crewRowFacts(read: CrewRowRead): CrewRowFacts | undefined {
  const { crew, current, mine } = read;
  if (crew === null || crew.crewmates.length === 0) return undefined;
  const faces = crewFaces(crew, mine);
  // Who needs you: a crewmate whose face says so, or whom the crew's waiting list names for
  // anything but a task ready to land — that one is the work's.
  const waiting = new Set(
    crew.attention.flatMap((row) =>
      !mine || row.handle === null || row.kind === "ready-to-land" ? [] : [row.handle],
    ),
  );
  const all = faces.map((face, index): CrewMini => {
    const kind = crew.crewmates[index]?.threadKind ?? null;
    const asks = face.state === "needs" || waiting.has(face.handle);
    const state = !current
      ? "idle"
      : asks
        ? "needs"
        : face.state === "working"
          ? "working"
          : "idle";
    const doing = !current
      ? undefined
      : (crewMiniDoingWord(kind, mine) ?? (asks ? CREW_MINI_NEEDS_WORD : undefined));
    return {
      id: face.handle,
      name: face.displayName,
      lead: face.lead,
      tint: face.tint,
      shape: MATE_SHAPE_OF_TINT[face.tint],
      state,
      doing,
    };
  });
  const rank = (mini: CrewMini) => (mini.state === "needs" ? 0 : mini.lead ? 1 : 2);
  const ordered = all.toSorted((a, b) => rank(a) - rank(b));
  const minis = ordered.length > WHOLE + 1 ? ordered.slice(0, WHOLE) : ordered;

  const nameOf = (handle: string) => all.find((mini) => mini.id === handle)?.name ?? handle;
  const ready = current && crew.personLands ? crew.readyTasks : [];
  const asking = all.filter((mini) => mini.state === "needs");
  const firstReady = ready[0];
  const need: CrewRowFacts["need"] =
    !current || !mine
      ? undefined
      : asking[0] !== undefined
        ? {
            kind: "ask",
            crewmate: asking[0].name,
            words: crewLineNeedsWord(asking.map((mini) => mini.name)),
          }
        : firstReady !== undefined
          ? {
              kind: "land",
              crewmate: nameOf(firstReady.owner),
              words: crewLineReadyWord(ready.map((task) => nameOf(task.owner))),
            }
          : undefined;

  const environmentId = read.environmentId;
  const reviewable = crewTaskReviewable(crew, read.logins, read.viewerSubject);
  const reviews =
    environmentId === undefined
      ? []
      : ready
          .filter((task) => reviewable(task.id))
          .map((task): CrewReviewItem => {
            const owner = all.find((mini) => mini.id === task.owner);
            const name = owner?.name ?? task.owner;
            return {
              key: `crew:${environmentId}:${task.id}`,
              target: { kind: "crew-task", environmentId, taskId: task.id },
              title: crewLineReadyWord([name]),
              crewmate: {
                name,
                tint: owner?.tint ?? faces[0]!.tint,
                shape: owner?.shape ?? MATE_SHAPE_OF_TINT[faces[0]!.tint],
              },
            };
          });

  return {
    minis,
    more: ordered.length - minis.length,
    known: current,
    need,
    reviews,
    words: crewRowWords(all),
  };
}
