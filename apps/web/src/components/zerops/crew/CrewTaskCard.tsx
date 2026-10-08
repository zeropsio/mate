/**
 * The task card in a crewmate's chat (PRD §4.5, seam 19): the engine's
 * message that hands the crewmate its task, drawn as a task — never as the
 * person's bubble. Above a stint's first card stands the seam that says why
 * this conversation began and links the one before it, unless the engine drew
 * that seam itself; the engine's seams (`crew.seam`) are `CrewSeamActivity`.
 *
 * The timeline knows only the card's text; the crew facts it needs — the
 * board, the stint's origin — come from `CrewTimelineContext`, which the chat
 * provides for a crew thread and nothing provides elsewhere.
 */
import {
  CREW_PREVIOUS_STINT_LINK,
  crewClosedWord,
  crewWentInWord,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type {
  CrewSeam,
  CrewTask,
  CrewTaskPage,
  CrewTaskPageInput,
  Crewmate,
  ThreadId,
} from "@t3tools/contracts";
import { createContext, use, useMemo } from "react";

import type { CrewCard } from "../../chat/conversation.logic";
import { crewTaskCardModel } from "./CrewTaskCard.logic";
import { CrewSeamLine } from "./CrewSeamLine";

export interface CrewTimeline {
  /** The timeline row of the stint's first card, while the conversation is loaded from its start. */
  readonly firstCardId: string | null;
  /** Why this stint began, and the stint before it; `null` for a crewmate's first conversation. */
  readonly origin: { readonly text: string; readonly previousThreadId: ThreadId | null } | null;
  readonly tasks: ReadonlyArray<CrewTask>;
  /** Whose conversation this is: its handle, and the crewmate once the crew is read. */
  readonly crewmate: { readonly handle: string; readonly profile: Crewmate | null };
  /** The Mate whose crew it is, named where work goes into its code. */
  readonly mateName: string;
  readonly onOpenThread: (threadId: ThreadId) => void;
  /**
   * _Change its job_: the crewmate's job in the Crew tab, as its menu opens it;
   * `null` for a viewer who may not change the crew.
   */
  readonly onChangeJob: (() => void) | null;
  /**
   * Reads the crewmate's finished work past the engine's bounded board (`crew.taskPage`); absent
   * where the board holds all of it (V1), or the Mate does not serve the read.
   */
  readonly readTaskPage?: ((input: CrewTaskPageInput) => Promise<CrewTaskPage>) | undefined;
}

export const CrewTimelineContext = createContext<CrewTimeline | null>(null);

const NO_TASKS: ReadonlyArray<CrewTask> = [];

export function CrewTaskCard({ id, card }: { readonly id: string; readonly card: CrewCard }) {
  const crew = use(CrewTimelineContext);
  const tasks = crew?.tasks ?? NO_TASKS;
  const model = useMemo(() => crewTaskCardModel(card, tasks), [card, tasks]);
  const origin = crew !== null && crew.firstCardId === id ? crew.origin : null;
  const previous = origin?.previousThreadId ?? null;
  return (
    <div className="flex flex-col gap-3">
      {origin === null ? null : (
        <CrewSeamLine
          link={
            previous === null
              ? undefined
              : { label: CREW_PREVIOUS_STINT_LINK, onOpen: () => crew?.onOpenThread(previous) }
          }
          text={origin.text}
        />
      )}
      <div
        className="flex flex-col gap-1 rounded-2xl border border-border/70 bg-card px-4 py-2.5"
        data-crew-task-card
      >
        <p className="min-w-0 truncate text-prose font-medium text-foreground">{model.heading}</p>
        {model.text.length === 0 ? null : (
          <p className="whitespace-pre-wrap text-line text-muted-foreground">{model.text}</p>
        )}
        {model.doneWhen === null ? null : (
          <p className="text-line text-muted-foreground">
            <span className="font-medium text-foreground">Done when:</span> {model.doneWhen}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * A seam the crew engine drew across the chat (`crew.seam`): work that went
 * into the Mate's code, or closed with nothing to add, by its title; a save
 * in the engine's words; and a new conversation linked to the one before it.
 */
export function CrewSeamActivity({
  seam,
  words,
}: {
  readonly seam: CrewSeam;
  readonly words: string;
}) {
  const crew = use(CrewTimelineContext);
  const previous = seam.seam === "stint" ? seam.previousThreadId : null;
  const mateName = crew?.mateName ?? "the Mate";
  const titleOf = (taskId: string) => crew?.tasks.find((task) => task.id === taskId)?.title ?? null;
  return (
    <CrewSeamLine
      link={
        previous === null || crew === null
          ? undefined
          : { label: CREW_PREVIOUS_STINT_LINK, onOpen: () => crew.onOpenThread(previous) }
      }
      text={
        seam.seam === "landed"
          ? crewWentInWord(titleOf(seam.taskId), mateName)
          : seam.seam === "closed"
            ? crewClosedWord(titleOf(seam.taskId), mateName)
            : words
      }
    />
  );
}
