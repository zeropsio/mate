/**
 * A Mate's peek: what you asked it, its plan and the step it is on, its last
 * words or what it waits on, and its change — without opening it.
 *
 * It floats to the right of the menu, level with the Mate's row, over the
 * page rather than in the list, so nothing in the list moves; on a phone it
 * is a sheet from the bottom. What it waits on is answered in place: a
 * question by its options (or a number key) or in words, an approval by its
 * choices, the command shown word for word. A Mate somebody else signed in
 * is read here, never run: its question shows, and who it waits for (D6).
 *
 * The card is pure — everything it says and does arrives as props — so the
 * design harness draws it from fixtures and the sidebar from the session.
 */
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";
import { ArrowUpRightIcon } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { Popover, PopoverPopup } from "../ui/popover";
import { Sheet, SheetPopup, SheetTitle } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
import { KeyChip, MateFace, StepGlyph } from "./primitives";
import {
  matePeekKey,
  type MatePeekChoice,
  type MatePeekDecision,
  type MatePeekStep,
} from "./SidebarMatePeek.logic";

/** A key typed into a field is text, never the peek's. */
function typedIntoField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * While a peek stands, its keys (`matePeekKey`): a number picks that choice,
 * x stops the run, Escape puts the peek away. Where the viewer may not answer
 * — or an answer is on its way — the numbers are nobody's.
 */
export function useMatePeekKeys(input: {
  readonly choices: ReadonlyArray<MatePeekChoice>;
  readonly answerable: boolean;
  readonly onChoose: (choice: MatePeekChoice) => void;
  readonly onStop: (() => void) | undefined;
  readonly onClose: () => void;
}): void {
  const { choices, answerable, onChoose, onStop, onClose } = input;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const action = matePeekKey({
        key: event.key,
        modified: event.metaKey || event.ctrlKey || event.altKey,
        typing: typedIntoField(event.target),
        choices: answerable ? choices.length : 0,
        canStop: onStop !== undefined,
      });
      if (action === undefined) return;
      if (action.kind === "close") {
        onClose();
        return;
      }
      event.preventDefault();
      if (action.kind === "stop") onStop?.();
      else {
        const choice = choices[action.index];
        if (choice !== undefined) onChoose(choice);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [answerable, choices, onChoose, onClose, onStop]);
}

export interface MatePeekCardProps {
  readonly name: string;
  readonly face: MateMarkState;
  readonly tint: MateTintId;
  readonly projectName: string | undefined;
  /** The row's own time slot — its age, its working clock, or when it picks up. */
  readonly time: ReactNode;
  /** "You asked", or whose ask it was. */
  readonly askedLabel: string;
  readonly task: string | undefined;
  readonly steps: ReadonlyArray<MatePeekStep> | undefined;
  /** The plan's label: *Plan*, or why it is not moving. */
  readonly stepsLabel: string;
  readonly lastWords: string | undefined;
  readonly decision: MatePeekDecision | undefined;
  /** Who a decision waits on when this viewer may not answer it (D6). */
  readonly waitingOn: string | undefined;
  /** An answer is on its way: the choices wait for it. */
  readonly responding: boolean;
  readonly onChoose: (choice: MatePeekChoice) => void;
  readonly onText: (text: string) => void;
  /** Its change's line — checks, number, title and *Merge* — drawn by the list. */
  readonly change: ReactNode | undefined;
  readonly appUrl: string | undefined;
  readonly onOpen: () => void;
  /** Stops the run it is on; absent while it rests. */
  readonly onStop: (() => void) | undefined;
  /** A phone's way to the Mate's menu, which has no right-click and no hover. */
  readonly onMore?: (() => void) | undefined;
}

function PeekSection({
  label,
  children,
  surface,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly surface: string;
}) {
  return (
    <section className="flex flex-col gap-1" data-zerops-peek-section={surface}>
      <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
      {children}
    </section>
  );
}

function PeekChoices({
  choices,
  disabled,
  onChoose,
}: {
  readonly choices: ReadonlyArray<MatePeekChoice>;
  readonly disabled: boolean;
  readonly onChoose: (choice: MatePeekChoice) => void;
}) {
  return (
    <div className="flex flex-col gap-1" data-zerops-surface="sidebar-mate-peek-choices">
      {choices.map((choice, index) => (
        <Button
          className="justify-start"
          data-zerops-peek-choice={index + 1}
          disabled={disabled}
          key={`${choice.value}:${String(index)}`}
          onClick={() => {
            onChoose(choice);
          }}
          size="sm"
          variant={choice.primary ? "default" : "outline"}
        >
          {index < 9 ? <KeyChip>{String(index + 1)}</KeyChip> : null}
          <span className="min-w-0 truncate">{choice.label}</span>
        </Button>
      ))}
    </div>
  );
}

function PeekAnswerField({
  placeholder,
  disabled,
  onText,
}: {
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly onText: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const text = value.trim();
        if (text.length === 0) return;
        onText(text);
        setValue("");
      }}
    >
      <Input
        aria-label={placeholder}
        autoComplete="off"
        disabled={disabled}
        id="sidebar-peek-answer"
        onChange={(event) => {
          setValue(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          // The list's keys stop here: a 1 typed into an answer is a 1.
          event.stopPropagation();
        }}
        placeholder={placeholder}
        size="sm"
        value={value}
      />
    </form>
  );
}

function PeekDecision({
  name,
  decision,
  waitingOn,
  responding,
  onChoose,
  onText,
}: {
  readonly name: string;
  readonly decision: MatePeekDecision;
  readonly waitingOn: string | undefined;
  readonly responding: boolean;
  readonly onChoose: (choice: MatePeekChoice) => void;
  readonly onText: (text: string) => void;
}) {
  const readOnly = waitingOn !== undefined;
  const waiting = readOnly ? (
    <p className="text-xs text-muted-foreground" data-zerops-surface="sidebar-mate-peek-waiting-on">
      {`Waiting for ${waitingOn}: only they can answer ${name}.`}
    </p>
  ) : null;
  switch (decision.kind) {
    case "question":
      return (
        <PeekSection label={`${name} asks`} surface="decision">
          <p className="text-sm leading-5 text-foreground">{decision.question}</p>
          {readOnly ? (
            waiting
          ) : (
            <>
              <PeekChoices choices={decision.choices} disabled={responding} onChoose={onChoose} />
              {decision.allowText ? (
                <PeekAnswerField
                  disabled={responding}
                  onText={onText}
                  placeholder="Or write your own answer"
                />
              ) : null}
            </>
          )}
        </PeekSection>
      );
    case "questions":
      return (
        <PeekSection label={`${name} asks`} surface="decision">
          <p className="text-sm leading-5 text-foreground">{decision.question}</p>
          <p className="text-xs text-muted-foreground">
            {decision.count > 1
              ? `${String(decision.count)} questions — answer them in the conversation.`
              : "It takes several answers — pick them in the conversation."}
          </p>
        </PeekSection>
      );
    case "approval":
      return (
        <PeekSection label="It needs your approval" surface="decision">
          <p className="text-sm leading-5 text-foreground">{decision.title}</p>
          {decision.detail === undefined ? null : (
            <pre className="max-h-32 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs leading-5 wrap-anywhere whitespace-pre-wrap text-foreground">
              {decision.detail}
            </pre>
          )}
          {readOnly ? (
            waiting
          ) : (
            <PeekChoices choices={decision.choices} disabled={responding} onChoose={onChoose} />
          )}
        </PeekSection>
      );
    case "plan":
      return (
        <PeekSection label="It has a plan" surface="decision">
          <p className="text-sm leading-5 text-foreground">
            It waits for you to look at its plan — open it to read and answer.
          </p>
        </PeekSection>
      );
    case "failure":
      return (
        <PeekSection label="What went wrong" surface="decision">
          <p className="text-sm leading-5 text-status-failed-text">
            {decision.message ?? "Its last run stopped with an error."}
          </p>
        </PeekSection>
      );
    case "reading":
      return (
        <PeekSection label={`${name} waits on you`} surface="decision">
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
        </PeekSection>
      );
  }
}

export function MatePeekCard(props: MatePeekCardProps) {
  const {
    name,
    face,
    tint,
    projectName,
    time,
    askedLabel,
    task,
    steps,
    stepsLabel,
    lastWords,
    decision,
    waitingOn,
    responding,
    onChoose,
    onText,
    change,
    appUrl,
    onOpen,
    onStop,
    onMore,
  } = props;
  return (
    <div className="flex w-full flex-col gap-3 py-1" data-zerops-surface="sidebar-mate-peek">
      <header className="flex min-w-0 items-center gap-2">
        <MateFace size="sm" state={face} tint={tint} />
        <span className="shrink-0 text-sm font-semibold text-foreground">{name}</span>
        {projectName === undefined ? null : (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{projectName}</span>
        )}
        <span className="ms-auto flex shrink-0 items-center">{time}</span>
      </header>
      {task === undefined ? null : (
        <PeekSection label={askedLabel} surface="task">
          <p className="line-clamp-3 text-sm leading-5 text-foreground">{task}</p>
        </PeekSection>
      )}
      {steps === undefined ? null : (
        <PeekSection label={stepsLabel} surface="plan">
          <ol className="flex flex-col gap-1">
            {steps.map((step, index) => (
              <li
                className="flex min-w-0 items-start gap-2 text-xs leading-4"
                data-zerops-peek-step={step.state}
                key={index}
              >
                <StepGlyph className="mt-px" state={step.state} />
                {step.text === undefined ? (
                  <Skeleton className="my-0.5 h-3 w-3/5" />
                ) : (
                  <span
                    className={
                      step.state === "running"
                        ? "min-w-0 font-medium text-foreground"
                        : "min-w-0 text-muted-foreground"
                    }
                  >
                    {step.text}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </PeekSection>
      )}
      {decision === undefined ? (
        lastWords === undefined ? null : (
          <PeekSection label="Last words" surface="last-words">
            <p className="line-clamp-4 text-sm leading-5 text-foreground">{lastWords}</p>
          </PeekSection>
        )
      ) : (
        <PeekDecision
          decision={decision}
          name={name}
          onChoose={onChoose}
          onText={onText}
          responding={responding}
          waitingOn={waitingOn}
        />
      )}
      {change === undefined ? null : (
        <PeekSection label="Change" surface="change">
          {change}
        </PeekSection>
      )}
      <footer className="-mx-1 flex items-center gap-1 border-t border-border pt-2">
        <Button onClick={onOpen} size="xs" variant="ghost">
          Open
          <Kbd>↵</Kbd>
        </Button>
        {appUrl === undefined ? null : (
          <Button
            render={<a href={appUrl} rel="noreferrer" target="_blank" />}
            size="xs"
            variant="ghost"
          >
            Open app
            <ArrowUpRightIcon aria-hidden="true" />
          </Button>
        )}
        {onMore === undefined ? null : (
          <Button onClick={onMore} size="xs" variant="ghost">
            More
          </Button>
        )}
        {onStop === undefined ? null : (
          <Button className="ms-auto" onClick={onStop} size="xs" variant="ghost-destructive">
            Stop
            <Kbd>X</Kbd>
          </Button>
        )}
      </footer>
    </div>
  );
}

/**
 * Where the peek stands: beside the menu, level with its Mate's row, or on a
 * phone a sheet from the bottom. A hover peek keeps the focus where it was —
 * somebody only looked — and the pointer can cross into it without it closing.
 */
export function MatePeekHost({
  open,
  phone,
  anchor,
  title,
  onClose,
  onPointerEnter,
  onPointerLeave,
  onInteract,
  children,
}: {
  readonly open: boolean;
  readonly phone: boolean;
  /** Finds the Mate's row, measured when the peek is placed. */
  readonly anchor: () => Element | null;
  readonly title: string;
  readonly onClose: () => void;
  readonly onPointerEnter: () => void;
  readonly onPointerLeave: () => void;
  /** Somebody worked in the peek: a hover peek becomes theirs to close. */
  readonly onInteract: () => void;
  readonly children: ReactNode;
}) {
  const titleId = useId();
  if (phone) {
    return (
      <Sheet
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        open={open}
      >
        {/* A handle, not a cross: the kit's cross sat on the peek's own time
            slot, and a sheet is put away the way sheets are — a tap above
            it, or Escape. */}
        <SheetPopup
          aria-labelledby={titleId}
          data-zerops-surface="sidebar-mate-peek-popup"
          showCloseButton={false}
          side="bottom"
        >
          <SheetTitle className="sr-only" id={titleId}>
            {title}
          </SheetTitle>
          <div className="px-4 pt-2 pb-3">
            <span
              aria-hidden="true"
              className="mx-auto mb-3 block h-1 w-9 rounded-full bg-border"
            />
            {children}
          </div>
        </SheetPopup>
      </Sheet>
    );
  }
  return (
    <Popover
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open={open}
    >
      <PopoverPopup
        align="start"
        anchor={{
          getBoundingClientRect: () => {
            const row = anchor();
            const box = row?.getBoundingClientRect();
            if (box === undefined) return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
            // Level with the row, beside the menu's own edge rather than the
            // row's, so the peek never covers the list.
            const edge = row?.closest('[data-sidebar="sidebar"]')?.getBoundingClientRect().right;
            return DOMRect.fromRect({
              x: edge ?? box.right,
              y: box.top,
              width: 0,
              height: box.height,
            });
          },
        }}
        aria-label={title}
        data-zerops-surface="sidebar-mate-peek-popup"
        finalFocus={false}
        initialFocus={false}
        onFocus={onInteract}
        onPointerDown={onInteract}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        padding="compact"
        side="right"
        sideOffset={8}
        width="md"
      >
        {children}
      </PopoverPopup>
    </Popover>
  );
}
