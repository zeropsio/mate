/**
 * "In Fen's code": the crew's work that went into the Mate's code, newest
 * first — the crewmate's face at 20 px, what it was, and when — the last
 * three, and *Show all N*, which opens every one (D4: every fold opens). A
 * line opens that work's review. While some of it has not shipped, the list
 * ends in "Fen hasn't shipped these yet · Ask Fen to ship them". Nothing is
 * drawn while nothing went in.
 */
import {
  CREW_WHAT_CHANGED,
  crewInCodeHeading,
  CREW_NOT_SHIPPED_SHORT,
  crewNotShippedWords,
  crewShipLine,
  crewShipWord,
  crewShowAllWord,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewTask, Crewmate } from "@t3tools/contracts";
import { useState } from "react";

import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { compactSidebarTimeLabel } from "../../Sidebar.logic";
import { MateFace } from "../primitives";
import { CrewHeading, CrewTextButton, CrewTip } from "./CrewParts";

/** How many pieces of work the list shows before *Show all*. */
const SHOWN = 3;

/** The work that went in — a commit, not a task closed with nothing of its own — newest first. */
export function crewWorkInCode(tasks: ReadonlyArray<CrewTask>): ReadonlyArray<CrewTask> {
  return tasks
    .filter((task) => task.state === "landed" && task.landedCommit !== null)
    .toSorted(
      (left, right) =>
        (right.landedAt ?? right.createdAt).localeCompare(left.landedAt ?? left.createdAt) ||
        right.number - left.number,
    );
}

export function CrewInFensCode({
  tasks,
  crewmates,
  notShipped,
  mateName,
  error,
  onReview,
  onShip,
}: {
  readonly tasks: ReadonlyArray<CrewTask>;
  readonly crewmates: ReadonlyArray<Crewmate>;
  /** How much of it has not shipped yet. */
  readonly notShipped: number;
  readonly mateName: string;
  /** *Ask Fen to ship them*'s refusal. */
  readonly error: string | null;
  readonly onReview: (taskId: string, from: HTMLElement) => void;
  readonly onShip: () => void;
}) {
  const [all, setAll] = useState(false);
  const work = crewWorkInCode(tasks);
  if (work.length === 0) return null;
  const shown = all ? work : work.slice(0, SHOWN);
  return (
    <div className="mt-8.5 flex flex-col @max-md:mt-7.5" data-crew-in-code>
      <CrewHeading>{crewInCodeHeading(mateName)}</CrewHeading>
      <div className="mt-1 flex flex-col">
        {shown.map((task) => {
          const owner = crewmates.find((mate) => mate.handle === task.owner);
          const when =
            task.landedAt === null
              ? ""
              : compactSidebarTimeLabel(formatRelativeTimeLabel(task.landedAt));
          return (
            <CrewTip key={task.id} tip={CREW_WHAT_CHANGED}>
              <button
                className="crew-code-row"
                data-crew-in-code-task={task.id}
                onClick={(event) => onReview(task.id, event.currentTarget)}
                type="button"
              >
                <span className="flex justify-center">
                  <MateFace size="sm" state="idle" tint={owner?.tint ?? "slate"} />
                </span>
                <span className="crew-ink-2 truncate text-line leading-4.5">{task.title}</span>
                <span className="text-line leading-4.5 tabular-nums text-muted-foreground">
                  {when}
                </span>
              </button>
            </CrewTip>
          );
        })}
      </div>
      {all || work.length <= SHOWN ? null : (
        <div className="flex h-7 items-center ps-14 pe-4 text-line leading-4.5">
          <CrewTextButton label={crewShowAllWord(work.length)} onPress={() => setAll(true)} />
        </div>
      )}
      {notShipped === 0 ? null : (
        <div className="mt-0.5 flex h-7 items-center gap-1.5 ps-14 pe-4 text-line leading-4.5 text-muted-foreground @max-md:h-8">
          {/* A phone's width says it short. */}
          <span className="truncate @max-md:hidden">{crewNotShippedWords(mateName)}</span>
          <span className="hidden @max-md:inline">{CREW_NOT_SHIPPED_SHORT}</span>
          <span aria-hidden="true">·</span>
          <CrewTextButton
            label={crewShipWord(mateName)}
            line={crewShipLine(mateName)}
            onPress={onShip}
          />
        </div>
      )}
      {error === null ? null : (
        <p className="ps-14 pe-4 text-line leading-4.5 text-status-failed-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
