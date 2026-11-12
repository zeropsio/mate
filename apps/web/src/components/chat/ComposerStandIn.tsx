/**
 * Where the composer stands while its conversation opens, before who writes there is known: the
 * composer's dock as `ChatView` draws it, holding the composer's room (`ComposerRoomHeld`), so the
 * conversation's own footer takes its place in the same frame, in the same place.
 */
import { useLayoutEffect, useRef, type ReactNode } from "react";

import { footStands } from "./footStanding";

import { cn } from "~/lib/utils";
import { COMPOSER_PROMPT_TYPE_CLASS_NAME } from "./composerTypography";
import { heldDraftRuns } from "./ComposerRoom.logic";
import { rememberStandInBox } from "~/zerops/bootPageMemory";

/**
 * Where the composer stands while its conversation opens, drawn as `ChatView` draws the composer's
 * dock: the room it holds takes the conversation's place in the same frame.
 */
export function ComposerStandInDock({
  children,
  held = false,
  box,
}: {
  readonly children: ReactNode;
  /** The room held unseen (`ComposerRoomHeld`). */
  readonly held?: boolean;
  /** How tall the box stands: as the one the person was looking at, or as at the last visit. */
  readonly box?: number | undefined;
}) {
  // Drawn, it is the box the view entered next holds (`footStanding`).
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = host.current;
    if (held || node === null) return;
    footStands(node, node.getBoundingClientRect().height);
    return () => footStands(node, null);
  }, [held, box]);
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 pt-6 sm:pt-7"
      data-composer-stand-in=""
    >
      <div className="w-full ps-(--workspace-gutter-start) pe-(--workspace-gutter-end)">
        <div className="pointer-events-auto relative z-10">
          <div className="relative">
            <div
              data-room-held={held ? "" : undefined}
              data-slot="composer-shell"
              // Drawn, it is the box the next load's first frame draws (`rememberStandInBox`).
              ref={held ? undefined : rememberStandInBox}
              className="chat-composer-glass-shell relative mx-auto w-full max-w-3xl"
            >
              <div
                className="chat-composer-glass-host relative z-10 w-full"
                ref={host}
                // The host wears the ring and the shadow: it is the box that stands that tall.
                style={held || box === undefined ? undefined : { height: box, overflow: "hidden" }}
              >
                <div className="relative z-10">{children}</div>
              </div>
            </div>
            <div
              aria-hidden
              className="h-[calc(env(safe-area-inset-bottom)+1rem)] sm:h-[calc(env(safe-area-inset-bottom)+1.25rem)]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The composer's room while who writes in the conversation is not known
 * (`conversationFooter`): the card at the composer's size with nothing in it — no field, no
 * caret, no buttons — its shell unseen (`data-room-held`), so whichever comes, the
 * composer or someone else's strip, takes its place without the page moving or anything taken
 * back. What the composer will carry at its top (`top`: a change waiting for review, or the room
 * kept for one) stands in the room too, unseen: the composer came 61 px taller than its room, and
 * the conversation over it jumped by that as it appeared.
 */
export function ComposerRoomHeld({
  draft = "",
  top = null,
}: {
  readonly draft?: string;
  readonly top?: ReactNode;
}) {
  return (
    <div aria-hidden className="mx-auto w-full min-w-0 max-w-3xl" data-composer-room-held="">
      <div className="relative">
        <div className="group relative z-10 p-px">
          {top === null || top === undefined ? null : (
            <div className="invisible" inert>
              {top}
            </div>
          )}
          {/* At a phone's width the composer comes folded to one line: its room is that line's,
              where the open composer's room stood 98 px taller and the conversation dropped by
              that as the composer came. */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 sm:hidden">
            <span className={cn("min-w-0 flex-1 truncate", COMPOSER_PROMPT_TYPE_CLASS_NAME)}>
              &nbsp;
            </span>
            <span className="size-8 shrink-0" />
          </div>
          <div className="relative px-3 pt-3.5 pb-2 max-sm:hidden sm:px-4 sm:pt-4">
            <div className={COMPOSER_PROMPT_TYPE_CLASS_NAME}>
              {/* The draft laid out as the editor will lay it out (`heldDraftRuns`), unseen. */}
              <div className="block max-h-50 min-h-17.5 w-full overflow-hidden whitespace-pre-wrap wrap-break-word leading-relaxed">
                {heldDraftRuns(draft).map((run, at) =>
                  run.kind === "text" ? (
                    // oxlint-disable-next-line react/no-array-index-key -- runs have no identity
                    <span key={at}>{run.text}</span>
                  ) : (
                    // oxlint-disable-next-line react/no-array-index-key -- runs have no identity
                    <span className="composer-attachment-slot" key={at}>
                      <span
                        className={run.kind === "picture" ? "block h-20 w-20" : "block h-20 w-42"}
                      />
                    </span>
                  ),
                )}
              </div>
            </div>
          </div>
          <div className="flex min-w-0 flex-nowrap items-center justify-end gap-2 pt-1.5 pe-3 pb-3 ps-3.5 max-sm:hidden">
            <span className="size-9 shrink-0 sm:size-8" />
          </div>
        </div>
      </div>
    </div>
  );
}
