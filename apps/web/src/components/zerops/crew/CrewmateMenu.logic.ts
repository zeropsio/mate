/**
 * A crewmate's menu, from the ⌄ on its pill in the conversation's line (the
 * owner, 2026-09-29: "still no idea whatsoever what any of these
 * functionalities will do"): its job's first sentence at the top, then each
 * press with one line under it saying what it does.
 *
 * - A writer: *Try its work* — its own app, run first while stopped, or its
 *   work shown at the Mate's dev address where its app cannot run on its own
 *   (`crewTry.ts`), the line saying which — then *Stop its app* while its app
 *   runs, with no line; *Change its job*; *Clear its conversation*.
 * - A reader: *Change its job*, *Clear its conversation*.
 * - The lead: *Change the brief*, *Clear its conversation*.
 *
 * Every word is the crew phrases' (R5). Pure: no clock, no I/O.
 */
import {
  CREW_MENU,
  CREW_MENU_LINES,
  crewJobSentence,
  crewTryWorkLine,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { Crewmate } from "@t3tools/contracts";

export type CrewmateMenuItemId = "try" | "stop" | "job" | "brief" | "clear";

export interface CrewmateMenuItem {
  readonly id: CrewmateMenuItemId;
  readonly label: string;
  /** What it does, under it; `null` for *Stop its app*. */
  readonly line: string | null;
  readonly enabled: boolean;
}

export interface CrewmateMenuModel {
  /** The job's first sentence, as the person reads it (`crewJobSentence`), at the top. */
  readonly heading: string;
  readonly items: ReadonlyArray<CrewmateMenuItem>;
}

export function crewmateMenuModel(input: {
  readonly crewmate: Pick<Crewmate, "kind" | "jobFirstLine" | "displayName">;
  readonly mateName: string;
  /**
   * *Try its work* for a writer: where it opens, whether a press does
   * anything now, and whether its own app runs to be stopped; `null` for a
   * crewmate with no copy of the code.
   */
  readonly tries: {
    readonly where: "own" | "dev";
    readonly enabled: boolean;
    readonly stops: boolean;
  } | null;
  /** A press would act on a crew not read yet, or one of its presses is on its way. */
  readonly busy: boolean;
}): CrewmateMenuModel {
  const { crewmate, tries, busy } = input;
  const clear: CrewmateMenuItem = {
    id: "clear",
    label: CREW_MENU.clearConversation,
    line: CREW_MENU_LINES.clearConversation,
    enabled: !busy,
  };
  const heading = crewJobSentence(crewmate.jobFirstLine, crewmate.displayName);
  if (crewmate.kind === "lead") {
    return {
      heading,
      items: [
        {
          id: "brief",
          label: CREW_MENU.changeBrief,
          line: CREW_MENU_LINES.changeBrief,
          enabled: true,
        },
        clear,
      ],
    };
  }
  const job: CrewmateMenuItem = {
    id: "job",
    label: CREW_MENU.changeJob,
    line: CREW_MENU_LINES.changeJob,
    enabled: true,
  };
  if (tries === null) return { heading, items: [job, clear] };
  const tryWork: CrewmateMenuItem = {
    id: "try",
    label: CREW_MENU.tryWork,
    line: crewTryWorkLine(input.mateName, tries.where),
    enabled: tries.enabled && !busy,
  };
  const stop: CrewmateMenuItem = {
    id: "stop",
    label: CREW_MENU.stopApp,
    line: null,
    enabled: !busy,
  };
  return { heading, items: tries.stops ? [tryWork, stop, job, clear] : [tryWork, job, clear] };
}
