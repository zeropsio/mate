/**
 * The Crew tab — right-panel kind `crew` — the crew's one home (the owner,
 * 2026-09-29: "shouldn't we put the 'setup crew' screen from the zerops tab to
 * the 'crew' tab?"). It is offered for every Mate whose crew mode is on, crew
 * or not (`rightPanelKinds.ts`), so setting one up has a home:
 *
 * - no crew yet: the empty state and *Set up a crew* (`CrewSectionEmpty`);
 * - a crew: its section, then its board, in one column. The section reads
 *   first — who is on the crew, what waits on you, the run and *Tell the
 *   crew*: what the tab is opened for, each a press away. The board follows
 *   as the record of every task by state; it lays its columns side by side
 *   once it is 48 rem wide (the panel maximized, or dragged wide), so it is the
 *   column's last block and the only one at the tab's full width, while the
 *   section keeps a reading measure.
 *
 * A tab kept open after crew mode went off says so; a feed not read yet draws
 * nothing.
 */
import { crewRefusalSentence } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import { useRef } from "react";

import { ScrollArea } from "~/components/ui/scroll-area";
import { useServerConfigs } from "~/state/entities";
import { hasCrewSurface, useCrew, type CrewRead } from "~/zerops/crew/useCrew";
import { useAskMate } from "~/zerops/useAskMate";
import { useEnvironmentProjectRef } from "~/zerops/useZeropsFeeds";
import { useZeropsMate } from "~/zerops/useZeropsMates";

import { CrewBoardHost } from "./CrewBoardPanel";
import { CrewSectionHost } from "./CrewSectionHost";

/** The Crew tab beside one conversation. */
export function CrewPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const { environmentId, threadId } = threadRef;
  const crew = useCrew(environmentId);
  const whoLivesHere = useZeropsMate(environmentId);
  const askMate = useAskMate();
  const projectId = useEnvironmentProjectRef(environmentId)?.projectId;
  const treeCwd = useServerConfigs().get(environmentId)?.cwd ?? null;
  const mate =
    whoLivesHere.kind === "mate"
      ? { name: whoLivesHere.mate.name, tint: whoLivesHere.mate.tint }
      : undefined;
  return (
    <CrewPanelBody
      crew={crew}
      environmentId={environmentId}
      mate={mate}
      // Every draft for the Mate goes into the chat the tab is open beside
      // when it is a person chat, else the main one.
      onAskMate={(draft) => askMate(projectId, draft, { threadId })}
      treeCwd={treeCwd}
    />
  );
}

export interface CrewPanelBodyProps {
  readonly environmentId: EnvironmentId;
  /** The crew as its feed reads it (`useCrew`). */
  readonly crew: CrewRead;
  /** The Mate who lives here, named where the engine says "your Mate". */
  readonly mate: { readonly name: string; readonly tint: MateTintId } | undefined;
  /** Your tree, where *Tell the crew*'s `@` finds files; `null` while unread. */
  readonly treeCwd: string | null;
  /** Hands the Mate a draft, confirmed first by the section. */
  readonly onAskMate: (draft: string) => void;
}

/** As much of an element as bringing it into view needs. */
interface Viewable {
  readonly scrollIntoView: (options: ScrollIntoViewOptions) => void;
  readonly focus: (options: FocusOptions) => void;
}

/**
 * *Review plan*, pressed in the section: the board's plan — the first card of
 * *Waiting on you* — brought into view under its column's title, sideways too
 * where the board's row scrolls, and handed the focus, so the keyboard goes
 * on to its Start. The board itself while its plan is not drawn.
 */
export function bringPlanIntoView(
  board: (Viewable & { readonly querySelector: (selector: string) => Viewable | null }) | null,
  options: { readonly reducedMotion: boolean },
): void {
  const plan = board?.querySelector("[data-crew-plan]") ?? null;
  const column =
    plan === null
      ? null
      : (board?.querySelector('[data-crew-board-column="waiting-on-you"]') ?? null);
  (column ?? board)?.scrollIntoView({
    behavior: options.reducedMotion ? "auto" : "smooth",
    block: "start",
    inline: "nearest",
  });
  plan?.focus({ preventScroll: true });
}

/** The tab's column for the crew it is handed — what a harness draws too. */
export function CrewPanelBody({
  environmentId,
  crew,
  mate,
  treeCwd,
  onAskMate,
}: CrewPanelBodyProps) {
  const board = useRef<HTMLDivElement>(null);
  if (crew.status === null) return null;
  if (!hasCrewSurface(crew.status) || crew.snapshot === null) {
    return (
      <p className="p-4 text-muted-foreground text-sm" data-crew-panel="off">
        {crewRefusalSentence("unavailable", null)}
      </p>
    );
  }
  const view = crew.status === "applied" ? crew.view : null;
  const showBoard = () => {
    bringPlanIntoView(board.current, {
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
  };
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-10 p-4" data-crew-panel={crew.status}>
        <div className="w-full max-w-3xl" data-crew-panel-block="section">
          <CrewSectionHost
            environmentId={environmentId}
            mate={mate}
            onAskMate={onAskMate}
            onShowBoard={view === null ? null : showBoard}
            snapshot={crew.snapshot}
            treeCwd={treeCwd}
            view={view}
          />
        </div>
        {view === null ? null : (
          <div className="scroll-mt-4" data-crew-panel-block="board" ref={board}>
            <CrewBoardHost
              current={crew.current}
              environmentId={environmentId}
              snapshot={crew.snapshot}
              view={view}
            />
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
