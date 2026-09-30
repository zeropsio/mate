/**
 * The Crew tab's head: the crew's goal — its title, its first lines on hover,
 * a click away from its view — the tab's ··· (*Change the goal*, *Add a
 * crewmate*, *Let it work on its own…* while no run is on), and the mode line
 * with its one press (`CrewHead.logic.ts`). No labels: the goal heads the
 * tab, and the line says how the crew works right now.
 *
 * The mode line's height is its own: its words change in place, fading in,
 * and nothing under it moves.
 *
 * For a viewer who may not change the crew, the goal's title only reads — its
 * first lines on hover still — and neither the ··· nor the mode line's press
 * is there.
 */
import {
  CREW_MENU,
  CREW_MENU_LABEL,
  CREW_MENU_LINES,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewSummary } from "@t3tools/contracts";

import { cn } from "~/lib/utils";

import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { CrewDots, CrewTextButton, CrewTip, useArrived } from "./CrewParts";
import { crewGoalTitle, type CrewModeLine, type CrewModePressKind } from "./CrewHead.logic";

export type CrewHeadMenuItem = "goal" | "addCrewmate" | "letItWork";

export function CrewHead({
  crew,
  mode,
  letItWork,
  error,
  onGoal,
  onMenu,
  onModePress,
}: {
  readonly crew: Pick<CrewSummary, "briefTitle" | "briefExcerpt">;
  readonly mode: CrewModeLine;
  /** *Let it work on its own…* is on offer: no run is on. */
  readonly letItWork: boolean;
  /** The mode line's refusal, or the engine's own last failure. */
  readonly error: string | null;
  /** The goal's view; `null` where the viewer may not change the crew. */
  readonly onGoal: (() => void) | null;
  /** The tab's ···; `null` where the viewer may not change the crew. */
  readonly onMenu: ((item: CrewHeadMenuItem) => void) | null;
  readonly onModePress: (press: CrewModePressKind) => void;
}) {
  const goal = crewGoalTitle(crew);
  const arrived = useArrived(mode.words);
  const items: ReadonlyArray<{
    readonly id: CrewHeadMenuItem;
    readonly label: string;
    readonly line: string;
  }> = [
    { id: "goal", label: CREW_MENU.changeGoal, line: CREW_MENU_LINES.changeGoal },
    { id: "addCrewmate", label: CREW_MENU.addCrewmate, line: CREW_MENU_LINES.addCrewmate },
    ...(letItWork
      ? [{ id: "letItWork" as const, label: CREW_MENU.letItWork, line: CREW_MENU_LINES.letItWork }]
      : []),
  ];
  return (
    <div className="flex flex-col gap-0.5 px-4 pt-4 @max-md:pt-3" data-crew-head>
      <div className="flex h-7 items-center gap-2">
        <CrewTip side="bottom" tip={goal.hover}>
          {onGoal === null ? (
            <span
              className={cn(
                "min-w-0 truncate font-semibold text-base leading-6",
                goal.placeholder ? "text-muted-foreground" : "text-foreground",
              )}
              data-crew-goal-title
            >
              {goal.title}
            </span>
          ) : (
            <button
              className={cn(
                "min-w-0 cursor-pointer truncate text-start font-semibold text-base leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                goal.placeholder ? "text-muted-foreground" : "text-foreground",
              )}
              data-crew-goal-title
              onClick={onGoal}
              type="button"
            >
              {goal.title}
            </button>
          )}
        </CrewTip>
        <span className="grow" />
        {onMenu === null ? null : (
          <Menu>
            <MenuTrigger
              render={
                <button
                  aria-label={CREW_MENU_LABEL}
                  className="crew-menu-btn -me-1.5 @max-md:-me-2"
                  type="button"
                />
              }
            >
              <CrewDots />
            </MenuTrigger>
            <MenuPopup align="end" className="w-79">
              {items.map((item) => (
                <MenuItem
                  data-crew-menu-item={item.id}
                  key={item.id}
                  onClick={() => onMenu(item.id)}
                >
                  <span className="flex min-w-0 flex-col px-0.75 py-0.75">
                    <span>{item.label}</span>
                    <span className="text-xs text-muted-foreground">{item.line}</span>
                  </span>
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        )}
      </div>
      <div className="flex h-5 items-center gap-2 text-line">
        <span
          className="crew-mode min-w-0 truncate text-line tabular-nums text-muted-foreground"
          data-arrived={arrived ? "" : undefined}
          data-crew-mode
          key={mode.words}
        >
          {mode.words}
        </span>
        <span className="grow" />
        {mode.press === null ? null : (
          <CrewTextButton
            label={mode.press.label}
            line={mode.press.line}
            onPress={() => {
              if (mode.press !== null) onModePress(mode.press.kind);
            }}
          />
        )}
      </div>
      {error === null ? null : (
        <p className="text-line leading-4.5 text-status-failed-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
