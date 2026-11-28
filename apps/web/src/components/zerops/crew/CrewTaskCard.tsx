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
  crewClearedWord,
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
import { createContext, use, useMemo, type ComponentProps } from "react";

import { Card } from "../../ui/card";
import type { CrewCard } from "../../chat/conversation.logic";
import { crewTaskCardModel } from "./CrewTaskCard.logic";
import { CrewRestartLine, CrewSeamLine } from "./CrewSeamLine";
import { useRecordedPerson } from "~/zerops/useZeropsMateOwners";
import { Text } from "~/components/ui/text";

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
      <Card data-crew-task-card>
        <div className="flex flex-col gap-1 px-3.75 py-2.5 max-sm:px-2.75">
          <p className="min-w-0 truncate text-prose font-medium text-foreground">{model.heading}</p>
          {model.text.length === 0 ? null : (
            <Text className="whitespace-pre-wrap" render={<p />} variant="remark">
              {model.text}
            </Text>
          )}
          {model.doneWhen === null ? null : (
            <Text render={<p />} variant="remark">
              <span className="font-medium text-foreground">Done when:</span> {model.doneWhen}
            </Text>
          )}
        </div>
      </Card>
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
  asEvent = false,
}: {
  readonly seam: CrewSeam;
  readonly words: string;
  /** Among the conversation's rows, a restart is said as an event; in a card, across it. */
  readonly asEvent?: boolean;
}) {
  const crew = use(CrewTimelineContext);
  const previous = seam.seam === "stint" ? seam.previousThreadId : null;
  const mateName = crew?.mateName ?? "the Mate";
  const titleOf = (taskId: string) => crew?.tasks.find((task) => task.id === taskId)?.title ?? null;
  const link =
    previous === null || crew === null
      ? undefined
      : { label: CREW_PREVIOUS_STINT_LINK, onOpen: () => crew.onOpenThread(previous) };
  if (seam.seam === "stint" && seam.by !== undefined) {
    return <CrewClearedLine asEvent={asEvent} by={seam.by} link={link} words={words} />;
  }
  if (asEvent && seam.seam === "stint") return <CrewRestartLine link={link} text={words} />;
  return (
    <CrewSeamLine
      link={link}
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

/**
 * *Start fresh*'s line, naming who pressed it: a colleague's press is never "You". Only this line
 * follows a person's name.
 */
function CrewClearedLine({
  by,
  words,
  link,
  asEvent,
}: {
  readonly by: string;
  readonly words: string;
  readonly link: ComponentProps<typeof CrewSeamLine>["link"];
  readonly asEvent: boolean;
}) {
  const clearedBy = useRecordedPerson(by);
  const text = clearedBy === null ? words : crewClearedWord(clearedBy);
  return asEvent ? (
    <CrewRestartLine link={link} text={text} />
  ) : (
    <CrewSeamLine link={link} text={text} />
  );
}
