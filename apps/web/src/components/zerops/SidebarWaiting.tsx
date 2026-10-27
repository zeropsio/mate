/**
 * Waiting on you: the list the Overview row's amber count opens beside the menu while something
 * waits (`SidebarOverviewRow`), the list's title on the row's title line. Each thing in the list has the
 * buttons that act on it: a plan is approved or changed, a question answered, a Mate of yours that
 * stopped asked to fix it, a change or a release reviewed. A thing whose action went through
 * leaves the list, its height closing in 200 ms. ⌥↓ steps through them in the menu.
 *
 * The rail's count opens the same list, beside the rail (`SidebarWaitingPopover`).
 */
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { EnvironmentId, ThreadId, type ProviderApprovalDecision } from "@t3tools/contracts";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { buildPlanImplementationPrompt } from "~/proposedPlan";
import { findLatestProposedPlan } from "~/session-logic";
import type { FixProblem } from "~/zerops/fixRequest";
import { REVIEW_LABEL } from "@t3tools/client-runtime/zerops";
import { useOpenReview } from "~/zerops/review";
import { useMateWrite } from "~/zerops/useMateWrite";

import { Kbd } from "../ui/kbd";
import { gatedPortal } from "../ui/portal-gate";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { mateDecision } from "./mateDecision.logic";
import { MateFace } from "./primitives";
import {
  releaseWaitingLine,
  waitingCountWords,
  waitingTitle,
  type WaitingItem,
  type WaitingMate,
} from "./SidebarWaiting.logic";
import { Button } from "~/components/ui/button";

const WaitingPortal = gatedPortal(PopoverPrimitive.Portal);

/** What the list asks of the menu: a Mate's conversation, and the fix request's composer. */
export interface WaitingVerbs {
  readonly onOpenMate: (projectId: string) => void;
  readonly onAskToFix: (projectId: string, problem: FixProblem) => void;
}

/** Where the list stands: beside the menu, its title on the trigger's title line. */
interface Placement {
  readonly sideOffset: number;
  readonly alignOffset: number;
}

/** The list's border, padding and half its title row: its title's centre below its top edge. */
const TITLE_CENTRE_PX = 29;
/** The air between the menu's edge and the list. */
const BESIDE_PX = 8;

function placementOf(trigger: HTMLElement): Placement {
  const box = trigger.getBoundingClientRect();
  const menu = trigger.closest('[data-sidebar="sidebar"]')?.getBoundingClientRect();
  const line = trigger.querySelector("[data-waiting-line]")?.getBoundingClientRect() ?? box;
  return {
    sideOffset: Math.round((menu?.right ?? box.right) - box.right + BESIDE_PX),
    alignOffset: Math.round(line.top + line.height / 2 - box.top - TITLE_CENTRE_PX),
  };
}

/** The list, opened from `trigger` — the menu's row, or the rail's count. */
export function SidebarWaitingPopover({
  items,
  verbs,
  trigger,
  children,
  tooltip,
}: {
  readonly items: ReadonlyArray<WaitingItem>;
  readonly verbs: WaitingVerbs;
  /**
   * The element that opens it, marked `[data-waiting-trigger]`; its `[data-waiting-line]` names
   * the line the list's title stands on.
   */
  readonly trigger: ReactElement<Record<string, unknown>>;
  readonly children?: ReactNode;
  /** What the trigger says on hover, beside it (the rail's count). */
  readonly tooltip?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>({ sideOffset: 16, alignOffset: -5 });
  const anchor = useRef<HTMLElement | null>(null);
  // Nothing waits any more: the list has nothing to hold.
  const shown = open && items.length > 0;
  return (
    <PopoverPrimitive.Root
      onOpenChange={(next, details) => {
        // What was pressed: the trigger the list stands beside.
        const pressed = details.event?.target;
        const from = pressed instanceof Element ? pressed.closest("[data-waiting-trigger]") : null;
        if (next && from instanceof HTMLElement) anchor.current = from;
        if (next && anchor.current !== null) setPlacement(placementOf(anchor.current));
        setOpen(next);
      }}
      open={shown}
    >
      {tooltip === undefined ? (
        <PopoverPrimitive.Trigger render={trigger}>{children}</PopoverPrimitive.Trigger>
      ) : (
        <Tooltip>
          <TooltipTrigger render={<PopoverPrimitive.Trigger render={trigger} />}>
            {children}
          </TooltipTrigger>
          <TooltipPopup side="right">{tooltip}</TooltipPopup>
        </Tooltip>
      )}
      <WaitingPortal>
        <PopoverPrimitive.Positioner
          align="start"
          alignOffset={placement.alignOffset}
          className="z-130"
          side="right"
          sideOffset={placement.sideOffset}
        >
          <PopoverPrimitive.Popup
            aria-label="Waiting on you"
            className="menu-wait-list"
            data-zerops-surface="sidebar-waiting-list"
          >
            <WaitingList
              items={items}
              onClose={() => {
                setOpen(false);
              }}
              verbs={verbs}
            />
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </WaitingPortal>
    </PopoverPrimitive.Root>
  );
}

/**
 * A bare count of what waits on the person — the menu's top, the Chief's row, the rail — that opens
 * the list; hovered, it says what it counts ("Waiting on you", the first things by name), so the
 * number never stands without its noun.
 */
export function SidebarWaitingCount({
  items,
  verbs,
  className,
}: {
  readonly items: ReadonlyArray<WaitingItem>;
  readonly verbs: WaitingVerbs;
  readonly className: string;
}) {
  const words = waitingCountWords(items);
  return (
    <SidebarWaitingPopover
      items={items}
      tooltip={
        <span className="menu-rail-tip">
          <span className="menu-rail-tip-name">
            Waiting on you
            <span className="menu-rail-tip-key">⌥↓</span>
          </span>
          <span className="menu-rail-tip-line">{words.line}</span>
        </span>
      }
      trigger={
        <button
          aria-label={words.label}
          className={className}
          data-waiting-trigger=""
          data-zerops-surface="sidebar-waiting"
          type="button"
        />
      }
      verbs={verbs}
    >
      <span data-zerops-surface="sidebar-waiting-count">{items.length}</span>
    </SidebarWaitingPopover>
  );
}

/** The row under Overview: drawn only while something waits. */
/** The list itself: its title, ⌥↓, and each thing with its buttons. */
export function WaitingList({
  items,
  verbs,
  onClose,
}: {
  readonly items: ReadonlyArray<WaitingItem>;
  readonly verbs: WaitingVerbs;
  readonly onClose: () => void;
}) {
  // The things whose action went through: gone from the list as their height closes, before the
  // sources say so.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const listed = items.filter((item) => !gone.has(item.key));
  return (
    <>
      <div className="menu-wait-head">
        <span className="menu-wait-heading">Waiting on you</span>
        <span className="menu-wait-key">
          <Kbd>⌥↓</Kbd>
          next
        </span>
      </div>
      <div className="menu-wait-items">
        {listed.map((item) => (
          <WaitingEntry
            item={item}
            key={item.key}
            onClose={onClose}
            onGone={() => {
              const next = new Set(gone).add(item.key);
              setGone(next);
              if (items.every((entry) => next.has(entry.key))) onClose();
            }}
            verbs={verbs}
          />
        ))}
      </div>
    </>
  );
}

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

/** Its height closes in 200 ms, then it is gone; with reduced motion it fades. */
function leave(element: HTMLElement | null, done: () => void) {
  if (element === null || typeof element.animate !== "function") {
    done();
    return;
  }
  element.style.pointerEvents = "none";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    element.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 150,
      fill: "forwards",
    }).onfinish = done;
    return;
  }
  const height = element.offsetHeight;
  element.style.overflow = "clip";
  element.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 120,
    easing: EASE,
    fill: "forwards",
  });
  element.animate(
    [
      { height: `${String(height)}px` },
      { height: "0px", paddingTop: "0px", paddingBottom: "0px", marginBottom: "0px" },
    ],
    { duration: 200, easing: EASE, fill: "forwards" },
  ).onfinish = done;
}

function WaitingEntry({
  item,
  verbs,
  onClose,
  onGone,
}: {
  readonly item: WaitingItem;
  readonly verbs: WaitingVerbs;
  readonly onClose: () => void;
  readonly onGone: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const went = () => {
    leave(element.current, onGone);
  };
  return (
    <div
      className="menu-wait-item"
      data-waiting-kind={item.kind}
      data-waiting-key={item.key}
      ref={element}
    >
      <span className="menu-wait-face" aria-hidden="true">
        {item.kind === "release" ? (
          <span className="menu-wait-letter">
            {item.release.name.trim().charAt(0).toUpperCase()}
          </span>
        ) : (
          <MateFace
            shape={item.mate.shape}
            size={32}
            state={item.mate.face}
            tint={item.mate.tint}
          />
        )}
      </span>
      <div className="menu-wait-body">
        <p className="menu-wait-title" data-waiting-title="">
          {waitingTitle(item)}
        </p>
        <p className="menu-wait-text">
          {item.kind === "release" ? releaseWaitingLine(item.release) : item.mate.text}
        </p>
        <div className="menu-wait-actions">
          {item.kind === "release" ? (
            <ReviewButton
              label="Review release"
              onClose={onClose}
              target={{ kind: "release", groupId: item.release.groupId }}
            />
          ) : item.kind === "change" ? (
            item.mate.change === undefined ? (
              <OpenButton mate={item.mate} onClose={onClose} verbs={verbs} />
            ) : (
              <ReviewButton
                label={REVIEW_LABEL}
                onClose={onClose}
                target={{
                  kind: "change",
                  groupId: item.mate.change.groupId,
                  repository: item.mate.change.repository,
                  number: item.mate.change.number,
                }}
              />
            )
          ) : item.kind === "failed" ? (
            <Button
              onClick={() => {
                verbs.onAskToFix(item.mate.projectId, {
                  what: `${item.mate.name} stopped on an error`,
                  error: item.mate.text,
                  ask: "Find out why, fix it, and carry on.",
                });
                went();
                onClose();
              }}
            >
              Ask {item.mate.name} to fix it
            </Button>
          ) : (
            <MateActions mate={item.mate} onClose={onClose} onDone={went} verbs={verbs} />
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewButton({
  label,
  target,
  onClose,
}: {
  readonly label: string;
  readonly target: Parameters<ReturnType<typeof useOpenReview>>[0];
  readonly onClose: () => void;
}) {
  const openReview = useOpenReview();
  return (
    <Button
      onClick={() => {
        // The list closes first, and the review opens over the page.
        onClose();
        openReview(target);
      }}
    >
      {label}
    </Button>
  );
}

function OpenButton({
  mate,
  verbs,
  onClose,
}: {
  readonly mate: WaitingMate;
  readonly verbs: WaitingVerbs;
  readonly onClose: () => void;
}) {
  return (
    <Button
      onClick={() => {
        onClose();
        verbs.onOpenMate(mate.projectId);
      }}
    >
      Open {mate.name}
    </Button>
  );
}

/**
 * A plan's and a question's buttons, read off the Mate's conversation as its composer reads it:
 * Approve plan and Change it…; a question's options and Answer…; an approval's choices. Anything
 * the list cannot answer in place — several questions at once — opens the conversation.
 */
function MateActions({
  mate,
  verbs,
  onDone,
  onClose,
}: {
  readonly mate: WaitingMate;
  readonly verbs: WaitingVerbs;
  readonly onDone: () => void;
  readonly onClose: () => void;
}) {
  const write = useMateWrite(
    mate.environmentId === undefined ? null : EnvironmentId.make(mate.environmentId),
    mate.threadId === undefined ? null : ThreadId.make(mate.threadId),
  );
  const [replying, setReplying] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const { detail, requests } = write;

  const settle = (pending: ReturnType<typeof write.send>) => {
    if (pending === undefined) {
      setError("Not sent: its conversation is still being read.");
      return;
    }
    setSending(true);
    setError(undefined);
    void pending.then((result) => {
      setSending(false);
      if (result._tag === "Success") onDone();
      else if (!isAtomCommandInterrupted(result)) setError("Not sent. Try again.");
    });
  };

  if (mate.kind === "plan") {
    const plan =
      detail === undefined
        ? null
        : findLatestProposedPlan(detail.proposedPlans, detail.latestTurn?.turnId ?? null);
    return (
      <Replying
        error={error}
        onCancel={() => {
          setReplying(false);
        }}
        onSend={(text) => {
          settle(write.send(text, "plan"));
        }}
        placeholder={`Tell ${mate.name} what to change`}
        replying={replying}
        sending={sending}
        label="What should change"
      >
        <Button
          disabled={plan === null || sending}
          onClick={() => {
            if (plan !== null)
              settle(write.send(buildPlanImplementationPrompt(plan.planMarkdown), "default"));
          }}
        >
          Approve plan
        </Button>
        <Button
          disabled={sending}
          onClick={() => {
            setReplying(true);
          }}
          variant="secondary"
        >
          Change it…
        </Button>
      </Replying>
    );
  }

  const decision =
    detail === undefined && requests.approvals.length === 0 && requests.userInputs.length === 0
      ? { kind: "reading" as const }
      : mateDecision({
          name: mate.name,
          kind: requests.approvals.length > 0 ? "approval" : "input",
          read: detail !== undefined,
          approvals: requests.approvals,
          userInputs: requests.userInputs,
          failure: undefined,
        });
  if (decision?.kind === "approval") {
    return (
      <Replying error={error} replying={false} sending={sending}>
        {decision.choices.map((choice) => (
          <Button
            disabled={sending}
            key={choice.value}
            onClick={() => {
              settle(write.decide(decision.requestId, choice.value as ProviderApprovalDecision));
            }}
            variant={choice.primary ? "primary" : "secondary"}
          >
            {choice.label}
          </Button>
        ))}
      </Replying>
    );
  }
  if (decision?.kind === "question") {
    return (
      <Replying
        error={error}
        label="Your answer"
        onCancel={() => {
          setReplying(false);
        }}
        onSend={(text) => {
          settle(write.answer(decision.requestId, decision.questionId, text));
        }}
        placeholder={`Your answer to ${mate.name}`}
        replying={replying}
        sending={sending}
      >
        {decision.choices.map((choice) => (
          <Button
            disabled={sending}
            key={choice.value}
            onClick={() => {
              settle(write.answer(decision.requestId, decision.questionId, choice.value));
            }}
            variant="secondary"
          >
            {choice.label}
          </Button>
        ))}
        {decision.allowText ? (
          <Button
            disabled={sending}
            onClick={() => {
              setReplying(true);
            }}
            variant="secondary"
          >
            Answer…
          </Button>
        ) : null}
      </Replying>
    );
  }
  // Still being read: its answer's way in stands, waiting for what it asks.
  if (decision?.kind === "reading" && mate.threadId !== undefined) {
    return (
      <Button disabled variant="secondary">
        Answer…
      </Button>
    );
  }
  // More than the list can answer in place, or no conversation to answer in: its conversation.
  return <OpenButton mate={mate} onClose={onClose} verbs={verbs} />;
}

/**
 * An item's buttons, or the one-line reply that takes their place: Enter sends, Esc gives the
 * buttons back.
 */
export function Replying({
  children,
  replying,
  sending,
  error,
  placeholder,
  label,
  onSend,
  onCancel,
}: {
  readonly children: ReactNode;
  readonly replying: boolean;
  readonly sending: boolean;
  readonly error: string | undefined;
  readonly placeholder?: string;
  readonly label?: string;
  readonly onSend?: (text: string) => void;
  readonly onCancel?: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (replying) field.current?.focus({ preventScroll: true });
  }, [replying]);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      const text = event.currentTarget.value.trim();
      if (text.length === 0 || sending) return;
      event.preventDefault();
      onSend?.(text);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel?.();
    }
  };
  return (
    <>
      {replying ? (
        <label className="menu-wait-reply">
          <input
            aria-label={label}
            disabled={sending}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            ref={field}
            type="text"
          />
          <Kbd>↵</Kbd>
        </label>
      ) : (
        children
      )}
      {error === undefined ? null : (
        <p className="menu-wait-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
