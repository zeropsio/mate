/**
 * **New task**, the Board's first line: a one-line title field ("New task…") at the top of every
 * application's Board. Focus or typing opens the brief and *Put on board* in place; *Put on board*
 * puts the task on the Board itself (source `board`, no conversation behind it). Offered to
 * everyone who sees the application (`BoardOffers.put`).
 *
 * The draft lives while the field is open and nowhere else: each draft has its own id, the card its
 * put is recorded and sent under (`boardPutRequestId`), so a second press or a Try again after a
 * lost answer is the same put and HQ makes one task. Escape or Cancel folds it and keeps nothing.
 * The field stays open while HQ is asked and until the Board read after HQ's answer holds the task
 * (`appTaskPut` done): then a new draft starts, folded, and the task stands in Queued from HQ's own
 * answer, never drawn ahead of it. HQ's refusal is said in place, the draft kept to send again;
 * where HQ's answer was lost, the draft is kept as it was sent, since its task may exist.
 */
import { BOARD_BRIEF_MAX, BOARD_TITLE_MAX } from "@t3tools/shared/hqIntake";
import type { TaskWriteAction } from "@t3tools/client-runtime/data";
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { cn, randomUUID } from "~/lib/utils";
import { useBoardOffers } from "~/zerops/useBoardTasks";
import { useAppTaskPut, useBoardTaskWrites } from "~/zerops/useTaskSourceSettings";

import { Button } from "../../ui/button";
import { Failure } from "../../ui/failure";
import { Input } from "../../ui/input";
import { Separator } from "../../ui/separator";
import { Text } from "../../ui/text";
import { Textarea } from "../../ui/textarea";
import { workingWords } from "../../settings/taskSourcesSettings.logic";
import { PUT_ON_BOARD } from "../board/BoardAskCard";

interface Draft {
  /** The card its put is recorded and sent under: one per draft. */
  readonly id: string;
  readonly title: string;
  readonly brief: string;
}

const freshDraft = (title = ""): Draft => ({ id: randomUUID(), title, brief: "" });

/** Hands the focus back to the folded title field, opening nothing (`handing` says so meanwhile). */
function handBack(field: RefObject<HTMLInputElement | null>, handing: RefObject<boolean>): void {
  handing.current = true;
  field.current?.focus();
  handing.current = false;
}

/** Said to a screen reader once the Board holds the task a put made. */
const PUT_SAID = "Put on the Board.";

/**
 * The Board's New task for application `appId`: keyed by it where it is drawn, so no draft follows
 * the person to another application. Drawn while the person's access is still read (HQ decides
 * again at the press); nothing where the rules say they may not put.
 */
export function NewBoardTask({ appId }: { readonly appId: string }) {
  const offers = useBoardOffers(appId);
  const writes = useBoardTaskWrites(appId);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => freshDraft());
  const [said, setSaid] = useState("");
  const field = useRef<HTMLInputElement | null>(null);
  // Focus handed back to the folded field opens nothing.
  const handingBack = useRef(false);
  // How many puts the Board holds since this field was drawn: each hands the focus back.
  const [puts, setPuts] = useState(0);
  const put = useAppTaskPut(appId, draft.id);
  // Put, and the Board read after HQ's answer holds it: a new draft starts, folded.
  if (put.kind === "done") {
    setDraft(freshDraft());
    setOpen(false);
    setSaid(PUT_SAID);
    setPuts(puts + 1);
  }
  useEffect(() => {
    if (puts > 0) handBack(field, handingBack);
  }, [puts]);
  if (offers?.put === false) return null;
  return (
    <NewBoardTaskView
      brief={draft.brief}
      fieldRef={field}
      onBrief={(brief) => {
        setDraft((now) => ({ ...now, brief }));
      }}
      onCancel={() => {
        setDraft(freshDraft());
        setOpen(false);
        handBack(field, handingBack);
      }}
      onLeave={() => {
        setOpen(false);
      }}
      onOpen={() => {
        if (handingBack.current) return;
        setSaid("");
        setOpen(true);
      }}
      onPut={
        writes === null
          ? undefined
          : () => {
              void writes.put(draft.id, { title: draft.title.trim(), brief: draft.brief.trim() });
            }
      }
      onTitle={(title) => {
        setDraft((now) => ({ ...now, title }));
        setSaid("");
        setOpen(true);
      }}
      open={open}
      put={put}
      said={said}
      title={draft.title}
    />
  );
}

/**
 * The status line, each sentence one line at a phone's width: where the put stands, HQ's refusal
 * in HQ's words, or a lost answer's way on.
 */
function StatusLine({ put }: { readonly put: TaskWriteAction }) {
  switch (put.kind) {
    case "working":
      return workingWords("task-put");
    case "failed":
      return <Failure cause={put.words} role="alert" size="line" />;
    case "unresolved":
      return <Failure cause="HQ may have it. Try again or cancel." role="alert" size="line" />;
    case "idle":
    case "done":
      return "It waits in Queued until someone takes it.";
  }
}

/** The field, drawn from what it is handed: its title line, and while open its brief and presses. */
export function NewBoardTaskView({
  open,
  title,
  brief,
  put,
  said = "",
  fieldRef,
  onOpen,
  onCancel,
  onLeave,
  onTitle,
  onBrief,
  onPut,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly brief: string;
  /** Where its put stands (`appTaskPut`). */
  readonly put: TaskWriteAction;
  /** What the field said last to a screen reader (a put the Board holds now); empty: nothing. */
  readonly said?: string;
  /** The title field, for focus handed back to it. */
  readonly fieldRef?: RefObject<HTMLInputElement | null> | undefined;
  readonly onOpen: () => void;
  /** Folds it and drops the draft. */
  readonly onCancel: () => void;
  /** Folds it as focus leaves it untouched; nothing to drop. */
  readonly onLeave: () => void;
  readonly onTitle: (title: string) => void;
  readonly onBrief: (brief: string) => void;
  /** Puts it; absent while no HQ or application is known. */
  readonly onPut: (() => void) | undefined;
}) {
  const putting = put.kind === "working";
  // HQ's answer was lost: its task may exist under this draft's id, so the draft is what was sent.
  const sent = put.kind === "unresolved";
  const ready = onPut !== undefined && title.trim() !== "" && brief.trim() !== "";
  const cancel = () => {
    if (!putting) onCancel();
  };
  return (
    <>
      <form
        className="grid min-w-0 px-4.5 py-3 [[data-flush]_&]:px-6"
        data-zerops-surface="board-new-task"
        onBlur={(event: FocusEvent<HTMLFormElement>) => {
          // Left untouched, it folds as focus leaves it; a draft stays open.
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          if (open && !putting && title.trim() === "" && brief.trim() === "") onLeave();
        }}
        onKeyDown={(event: KeyboardEvent<HTMLFormElement>) => {
          // Escape while an input method composes is the composition's, never the draft's.
          if (event.key !== "Escape" || !open || event.nativeEvent.isComposing) return;
          event.preventDefault();
          cancel();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !putting) onPut?.();
        }}
      >
        <Input
          aria-label="New task: its title"
          autoComplete="off"
          disabled={putting}
          maxLength={BOARD_TITLE_MAX}
          nativeInput
          onChange={(event) => {
            onTitle(event.target.value);
          }}
          onFocus={() => {
            if (!open) onOpen();
          }}
          placeholder="New task…"
          readOnly={sent}
          ref={fieldRef}
          value={title}
        />
        {/* The brief and the presses open under the title in place, their height eased. */}
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-200 ease-out-strong motion-reduce:transition-none",
            open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
          inert={!open}
        >
          <div className="min-h-0 overflow-clip [overflow-clip-margin:4px]">
            <div className="grid gap-2 pt-2">
              <Textarea
                aria-label="Brief"
                disabled={putting}
                maxLength={BOARD_BRIEF_MAX}
                onChange={(event) => {
                  onBrief(event.target.value);
                }}
                placeholder="What should be done, and how will we know it’s done?"
                readOnly={sent}
                size="lg"
                value={brief}
              />
              {/* One line's room, held, its words fit a phone's width: neither a press nor a
                  refusal moves the presses under it. */}
              <Text className="min-h-5" render={<p />} truncate variant="description">
                <StatusLine put={put} />
              </Text>
              <div className="flex min-w-0 justify-end gap-2">
                <Button disabled={putting} onClick={cancel} size="sm" variant="ghost">
                  Cancel
                </Button>
                <Button disabled={!ready || putting} size="sm" type="submit" variant="primary">
                  {PUT_ON_BOARD}
                </Button>
              </div>
            </div>
          </div>
        </div>
        <span aria-live="polite" className="sr-only">
          {said}
        </span>
      </form>
      <Separator />
    </>
  );
}
