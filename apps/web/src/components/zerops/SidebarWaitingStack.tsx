/**
 * The Mates waiting on you, as their faces in the menu's header.
 *
 * A question, an approval, a plan, a failure — anything the one resolver
 * reads as waiting on a person wears the "needs you" face (R5), and those
 * faces stack in the header's right slot. The slot is always there, so the
 * header never moves when the stack comes or goes. Pressing it — or ⌥↓ —
 * goes to the next one below whichever is in view: its project opens if it
 * was collapsed, and its row takes the focus and flashes once, the question
 * on its last line.
 *
 * No count and no word: four faces at most, then how many more — fewer where
 * the logo row is narrow, since the faces give way before the lockup and ⌘K
 * do (`waitingFacesThatFit`).
 */
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";
import { useState } from "react";

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

/** The slot the logo row keeps the stack at its widest: `max-w-24` (`SidebarChromeHeader`). */
const WAITING_SLOT_PX = 96;

/** The stack's parts in px: the button's padding, a face, each next face past the one before it, the count's gap and one of its glyphs. */
const STACK_PAD_PX = 12;
const FACE_PX = 20;
const FACE_STEP_PX = 14;
const MORE_GAP_PX = 4;
const MORE_GLYPH_PX = 7;

function stackWidth(shown: number, more: number): number {
  const faces = FACE_PX + FACE_STEP_PX * (shown - 1);
  const count = more > 0 ? MORE_GAP_PX + MORE_GLYPH_PX * (1 + String(more).length) : 0;
  return STACK_PAD_PX + faces + count;
}

/**
 * How many faces fit the room the logo row leaves the stack, and how many
 * more it counts: as many as fit with their count, else one face alone, else
 * none — the lockup and ⌘K stay whole. Beside macOS's traffic lights a 304 px
 * menu fits three and a count, a 256 px one a single face.
 */
export function waitingFacesThatFit(
  room: number,
  count: number,
): { readonly shown: number; readonly more: number } {
  for (let shown = Math.min(count, WAITING_FACES); shown >= 1; shown -= 1) {
    if (stackWidth(shown, count - shown) <= room) return { shown, more: count - shown };
  }
  return count > 0 && stackWidth(1, 0) <= room ? { shown: 1, more: 0 } : { shown: 0, more: 0 };
}

export function SidebarWaitingStack({
  mates,
  onNext,
}: {
  readonly mates: ReadonlyArray<WaitingMate>;
  readonly onNext: () => void;
}) {
  // The room the logo row leaves the stack, read as the slot is drawn —
  // before it paints — and whenever the row resizes; the whole slot until
  // read (a server's render).
  const [room, setRoom] = useState(WAITING_SLOT_PX);
  const slot = (element: HTMLDivElement | null) => {
    if (element === null) return;
    const read = () => {
      setRoom(element.getBoundingClientRect().width);
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  };
  if (mates.length === 0) return null;
  const fit = waitingFacesThatFit(room, mates.length);
  const shown = mates.slice(0, fit.shown);
  const { more } = fit;
  const says = `${namesInOneBreath(mates.map((mate) => mate.name))} ${mates.length === 1 ? "waits" : "wait"} on you`;
  return (
    <div className="flex min-w-0 flex-1 items-center justify-end" ref={slot}>
      {shown.length === 0 ? null : (
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
      )}
    </div>
  );
}
