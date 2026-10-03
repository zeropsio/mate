/**
 * The composer as it stands where no conversation is open yet: a Mate's own
 * view while its link is made (`ZeropsMateComingPage`). A switch from a
 * conversation to a Mate not reachable yet left the pane without a composer
 * for as long as the link took — 2.5 s and more — and its conversation's
 * composer came back once it opened: the one thing the person writes in
 * blinked out and in. This one stands in its place in the meantime, drawn
 * as `ChatView` draws the composer's dock and `ChatComposer` its card, so the
 * conversation's own takes over in the same frame, in the same place.
 *
 * It takes typing: what the person writes while the Mate connects is the
 * conversation's draft once it opens (`mateHandOver.ts`), the caret where
 * they left it. Nothing is sent from it — its send waits, as Enter does. The
 * toolbar's model stands as the conversation's last stood, still; its meter
 * comes with the conversation.
 */
import { useEffect, useRef, type ReactNode } from "react";

import { ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER } from "../../composerPlaceholder";
import { COMPOSER_PROMPT_TYPE_CLASS_NAME } from "../ComposerPromptEditor";
import type { ComposerControlLook } from "./composerControlMemory";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { ComposerModelControlStill } from "./ProviderModelPicker";
import { ContextWindowMeterPlaceholder } from "./ContextWindowMeter";
import { shouldTypeToFocusComposer } from "./typeToFocus";

const nothing = () => undefined;

/** What the person typed into the stand-in, and where the caret stands in it. */
export interface StandInTyped {
  readonly text: string;
  readonly caret: number;
}

export function ComposerStandIn({
  typed,
  onType,
  control = null,
}: {
  readonly typed: StandInTyped;
  readonly onType: (typed: StandInTyped) => void;
  /** The conversation's control as it last stood (`composerControlMemory`), drawn still. */
  readonly control?: ComposerControlLook | null;
}) {
  const report = (field: HTMLTextAreaElement) =>
    onType({ text: field.value, caret: field.selectionEnd });
  // Where the person types, as the conversation's composer is: it takes the
  // focus as it arrives, and a key typed with nothing to type into.
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const typedRef = useRef(typed);
  const onTypeRef = useRef(onType);
  useEffect(() => {
    typedRef.current = typed;
    onTypeRef.current = onType;
  });
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const field = fieldRef.current;
      if (field === null) return;
      const end = field.value.length;
      field.focus({ preventScroll: true });
      field.setSelectionRange(end, end);
    });
    const onKeyDown = (event: KeyboardEvent) => {
      const field = fieldRef.current;
      if (field === null || !shouldTypeToFocusComposer(event)) return;
      event.preventDefault();
      const text = `${typedRef.current.text}${event.key}`;
      onTypeRef.current({ text, caret: text.length });
      field.focus({ preventScroll: true });
      requestAnimationFrame(() => field.setSelectionRange(text.length, text.length));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
  return (
    <ComposerStandInDock>
      <div className="mx-auto w-full min-w-0 max-w-3xl">
        <div className="relative">
          <div className="group relative z-10 p-px">
            <div>
              <div className="relative px-3 pt-3.5 pb-2 sm:px-4 sm:pt-4">
                <div className={COMPOSER_PROMPT_TYPE_CLASS_NAME}>
                  <textarea
                    ref={fieldRef}
                    aria-label="Message"
                    className="block field-sizing-content max-h-50 min-h-17.5 w-full resize-none overflow-y-auto bg-transparent p-0 leading-relaxed text-foreground outline-none placeholder:text-placeholder"
                    onChange={(event) => report(event.currentTarget)}
                    onKeyDown={(event) => {
                      // Nothing is sent before the conversation opens.
                      if (event.key === "Enter" && !event.shiftKey) event.preventDefault();
                    }}
                    onSelect={(event) => report(event.currentTarget)}
                    placeholder={ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER}
                    rows={1}
                    value={typed.text}
                  />
                </div>
              </div>
              <div className="flex min-w-0 flex-nowrap items-center justify-between gap-2 overflow-visible pt-1.5 pe-3 pb-3 ps-3.5">
                <div className="-m-1 -ms-3.5 flex min-w-0 flex-1 items-center gap-2 overflow-hidden p-1 ps-3.5">
                  {control === null ? null : <ComposerModelControlStill look={control} />}
                </div>
                <div className="flex shrink-0 flex-nowrap items-center justify-end gap-2">
                  <ContextWindowMeterPlaceholder />
                  <ComposerPrimaryActions
                    compact={false}
                    pendingAction={null}
                    isRunning={false}
                    showPlanFollowUpPrompt={false}
                    promptHasText={false}
                    isSendBusy={false}
                    sendDisabledReason="Opening this conversation…"
                    isConnecting={false}
                    isEnvironmentUnavailable={false}
                    isPreparingWorktree={false}
                    hasSendableContent={false}
                    onPreviousPendingQuestion={nothing}
                    onInterrupt={nothing}
                    onImplementPlanInNewThread={nothing}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ComposerStandInDock>
  );
}

/**
 * Where the composer stands while its conversation opens, drawn as `ChatView` draws the composer's
 * dock: what stands in it — the composer, its room held, someone else's strip — takes the
 * conversation's place in the same frame.
 */
export function ComposerStandInDock({
  children,
  held = false,
}: {
  readonly children: ReactNode;
  /** The room held unseen (`ComposerRoomHeld`). */
  readonly held?: boolean;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 pt-1.5 sm:pt-2"
      data-composer-stand-in=""
    >
      <div className="w-full ps-(--workspace-gutter-start) pe-(--workspace-gutter-end)">
        <div className="pointer-events-auto relative z-10">
          <div className="relative">
            <div
              data-room-held={held ? "" : undefined}
              data-slot="composer-shell"
              className="chat-composer-glass-shell relative mx-auto w-full max-w-3xl"
            >
              <div className="chat-composer-glass-host relative z-10 w-full">
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
 * caret, no words, no buttons — its shell unseen (`data-room-held`), so whichever comes, the
 * composer or someone else's strip, takes its place without the page moving or anything taken
 * back.
 */
export function ComposerRoomHeld() {
  return (
    <div aria-hidden className="mx-auto w-full min-w-0 max-w-3xl" data-composer-room-held="">
      <div className="relative">
        <div className="group relative z-10 p-px">
          <div className="relative px-3 pt-3.5 pb-2 sm:px-4 sm:pt-4">
            <div className={COMPOSER_PROMPT_TYPE_CLASS_NAME}>
              <div className="min-h-17.5 leading-relaxed" />
            </div>
          </div>
          <div className="flex min-w-0 flex-nowrap items-center justify-end gap-2 pt-1.5 pe-3 pb-3 ps-3.5">
            <span className="size-9 shrink-0 sm:size-8" />
          </div>
        </div>
      </div>
    </div>
  );
}
