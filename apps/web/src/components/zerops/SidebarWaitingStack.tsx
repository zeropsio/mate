/**
 * The Mates waiting on you, as their faces in the menu's header.
 *
 * A question, an approval, a plan, a failure — anything the one resolver
 * reads as waiting on a person wears the "needs you" face (R5), and those
 * faces stack in the header's right slot. The slot is always there, so the
 * header never moves when the stack comes or goes. Pressing it — or ⌥↓ —
 * goes to the next one below whichever is in view: its project opens if it
 * was collapsed, its row takes the focus and its peek opens, where the
 * question is answered.
 *
 * No count and no word: four faces at most, then how many more.
 */
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";

import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MateFace } from "./primitives";

export interface WaitingMate {
  readonly projectId: string;
  readonly name: string;
  readonly tint: MateTintId;
  readonly face: MateMarkState;
}

/** "Kai", "Kai and Juno", "Kai, Juno and Mika". */
export function namesInOneBreath(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** How many faces the stack shows before it counts the rest. */
export const WAITING_FACES = 4;

export function SidebarWaitingStack({
  mates,
  onNext,
}: {
  readonly mates: ReadonlyArray<WaitingMate>;
  readonly onNext: () => void;
}) {
  if (mates.length === 0) return null;
  const shown = mates.slice(0, WAITING_FACES);
  const more = mates.length - shown.length;
  const says = `${namesInOneBreath(mates.map((mate) => mate.name))} ${mates.length === 1 ? "waits" : "wait"} on you`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={`${says}. Go to the next one: Option and Down.`}
            className="flex h-7 cursor-pointer items-center rounded-full px-1.5 outline-none transition-colors [-webkit-app-region:no-drag] hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring"
            data-zerops-surface="sidebar-waiting"
            onClick={onNext}
            type="button"
          />
        }
      >
        <span className="flex -space-x-1.5">
          {shown.map((mate, index) => (
            <span
              className="flex rounded-full ring-2 ring-sidebar"
              data-zerops-waiting-mate={mate.projectId}
              key={mate.projectId}
              style={{ zIndex: shown.length - index }}
            >
              <MateFace size="sm" state={mate.face} tint={mate.tint} />
            </span>
          ))}
        </span>
        {more > 0 ? (
          <span className="ms-1 text-xs text-sidebar-muted-foreground tabular-nums">
            {`+${String(more)}`}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <span className="flex items-center gap-1.5">
          {says}
          <Kbd>⌥↓</Kbd>
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}
