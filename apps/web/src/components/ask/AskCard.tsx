/**
 * One card for everything a Mate asks of a person, in two densities: `full` in the conversation
 * where it was asked, `compact` above the composer while the Mate is stopped on it. Top to bottom:
 * where it acts, what the main press does, the Mate's why in its words, the body (`AskFacts`,
 * `AskSteps`, `AskSecretField`, `AskRevealed`), and the footer (`AskFooter`) — the only part that
 * changes with the state, so the card stays where the person saw it. Production is the only red:
 * its chip and its main press. Props only: each kind's container reads its source.
 */
import { Children, Fragment, type ReactNode, useState } from "react";

import { cn } from "~/lib/utils";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Spinner } from "../ui/spinner";
import { useReportAskOnScreen } from "./askReveal";
import {
  type AskState,
  type AskStateKind,
  type AskWhere,
  NOT_NOW,
  askWhereWords,
  isProduction,
} from "./ask.logic";

export type AskDensity = "full" | "compact";

export interface AskCardProps {
  /** The ask's identity: what "Show in conversation" lands on. */
  readonly askId: string;
  /** Which kind of ask it is ("vault"), for what reads the card and the composer's top. */
  readonly kind: string;
  readonly density: AskDensity;
  /** Where it acts; `null` for an ask that acts nowhere (a message, a question). */
  readonly where: AskWhere | null;
  /** A verb and its subject: what the main press does. */
  readonly title: string;
  /** The Mate's own words for why it asks. */
  readonly why?: { readonly who: string; readonly words: string } | null | undefined;
  readonly state: AskStateKind;
  /** Compact: the asking Mate's face, waiting on the person. */
  readonly face?: ReactNode;
  /** Compact: goes to the card in the conversation. */
  readonly onShowInConversation?: (() => void) | undefined;
  /** Compact: one quiet line under the title ("Goes to the vault, not the chat"). */
  readonly note?: ReactNode;
  readonly children?: ReactNode;
  readonly footer: ReactNode;
}

function WhereChip({ where }: { readonly where: AskWhere | null }) {
  if (where === null) return null;
  return <Badge tone={isProduction(where) ? "danger" : "neutral"}>{askWhereWords(where)}</Badge>;
}

export function AskCard(props: AskCardProps) {
  return props.density === "compact" ? <AskCardFace {...props} /> : <FullAskCard {...props} />;
}

/** The conversation's card says whether it is in view, so the dock shows only while it is not. */
function FullAskCard(props: AskCardProps) {
  return <AskCardFace {...props} cardRef={useReportAskOnScreen(props.askId)} />;
}

function AskCardFace(
  props: AskCardProps & { readonly cardRef?: ((node: HTMLElement | null) => void) | undefined },
) {
  const { title, why } = props;
  // Nothing to draw is no body, and no gap for one.
  const body = Children.toArray(props.children).length === 0 ? undefined : props.children;
  const marks = {
    "aria-label": title,
    role: "group",
    "data-ask-id": props.askId,
    "data-ask-kind": props.kind,
    "data-ask-density": props.density,
    "data-ask-state": props.state,
  } as const;

  if (props.density === "compact") {
    return (
      <AskDock
        actions={
          <>
            {props.footer}
            {props.onShowInConversation === undefined ? null : (
              <Button onClick={props.onShowInConversation} size="sm" variant="ghost">
                Show in conversation
              </Button>
            )}
          </>
        }
        askId={props.askId}
        detail={props.note}
        face={props.face}
        kind={props.kind}
        label={title}
        state={props.state}
        title={title}
        where={props.where}
      >
        {body}
      </AskDock>
    );
  }

  return (
    <Card {...marks} ref={props.cardRef} size="sm" variant="flat">
      <div className="grid min-w-0 gap-3">
        <div className="grid min-w-0 justify-items-start gap-1.5">
          <WhereChip where={props.where} />
          <p className="text-emphasis font-medium text-foreground">{title}</p>
        </div>
        {why === null || why === undefined ? null : (
          <p className="text-body text-muted-foreground" data-ask-why>
            <span className="font-medium">{why.who}:</span> <q>{why.words}</q>
          </p>
        )}
        {body === undefined ? null : <div className="grid min-w-0 gap-2">{body}</div>}
        {props.footer}
      </div>
    </Card>
  );
}

/**
 * The compact density: an ask above the composer, where the Mate waits on the person, in the one
 * look every ask there has (the owner's pick, "Composer Strips" S6): the asking Mate's face, where
 * it acts and what it asks in one line, a quiet line under it, the presses at the end — under
 * everything once the composer is too narrow for both — and what it asks with under the line.
 */
export function AskDock(props: {
  /** What a screen reader calls it. */
  readonly label: string;
  /** Which ask it is, for what reads the composer's top (`data-composer-top`). */
  readonly kind: string;
  readonly face: ReactNode;
  readonly where?: AskWhere | null | undefined;
  /** What it asks, in one line. */
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  /** Its presses: the main one and Not now, or the kind's own. */
  readonly actions?: ReactNode;
  /** What it asks with: the options, a value's field. */
  readonly children?: ReactNode;
  readonly askId?: string | undefined;
  readonly state?: AskStateKind | undefined;
}) {
  return (
    <section
      aria-label={props.label}
      className="@container border-foreground/8 border-b"
      // It stands over the conversation's end and never moves it (`ChatView`).
      data-chat-composer-asks="true"
      data-composer-top={props.kind}
      data-ask-density="compact"
      data-ask-id={props.askId}
      data-ask-kind={props.kind}
      data-ask-state={props.state}
      role="group"
    >
      {/* What is asked comes before its presses, for a reader and for the Tab key; the grid sets
          the presses beside the line, and under everything once the composer is too narrow. */}
      <div className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 pt-3 pe-2 pb-3 ps-4 @max-xl:grid-cols-[28px_minmax(0,1fr)]">
        <div className="col-start-1 row-start-1 grid place-items-center">{props.face}</div>
        <div className="col-start-2 row-start-1 min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <WhereChip where={props.where ?? null} />
            <p className="min-w-0 truncate font-medium text-foreground text-line leading-4.5">
              {props.title}
            </p>
          </div>
          {props.detail === undefined ? null : (
            <div className="min-w-0 text-muted-foreground text-line leading-4.5">
              {props.detail}
            </div>
          )}
        </div>
        {/* A folded panel leaves it empty, and an empty row would still take the grid's gap. */}
        {props.children === undefined ? null : (
          <div className="col-start-2 -col-end-1 row-start-2 min-w-0 empty:hidden">
            {props.children}
          </div>
        )}
        {props.actions === undefined ? null : (
          <div className="col-start-3 row-start-1 flex min-w-0 flex-wrap items-center justify-end gap-1 @max-xl:col-start-2 @max-xl:-col-end-1 @max-xl:row-start-auto">
            {props.actions}
          </div>
        )}
      </div>
    </section>
  );
}

export interface AskFooterProps {
  readonly state: AskState;
  readonly density: AskDensity;
  /** The main press, named for its result: "Save to vault", "Set on production". */
  readonly main?:
    | { readonly label: string; readonly onPress: () => void; readonly disabled?: boolean }
    | null
    | undefined;
  /** Its target is Production, or it stops or deletes: the main press carries the risk colour. */
  readonly destructive?: boolean;
  readonly onNotNow?: (() => void) | undefined;
  /** More presses between the main one and Not now: "Only Juno". */
  readonly also?: ReactNode;
  /** A quiet note after the presses while it waits: "Goes to the vault, not the chat". */
  readonly note?: ReactNode;
  /** The one press beside a line: Try again, Ask Petr, Open it again, Hide. */
  readonly action?: ReactNode;
}

/**
 * What the ask's state says, in its one place: the presses while it waits (the pressed one
 * spinning while it works, the others held), else one line in the source's words with at most
 * one press beside it. A line that replaces the presses fades in; one drawn as the card first
 * paints is placed.
 */
export function AskFooter(props: AskFooterProps) {
  const { state, density } = props;
  const size = density === "compact" ? "sm" : "md";
  const pressing = state.kind === "waiting" || (state.kind === "working" && state.pressed !== null);
  const face = pressing ? "presses" : state.kind;
  const [first] = useState(face);
  const [moved, setMoved] = useState(false);
  if (!moved && face !== first) setMoved(true);

  const body = pressing ? (
    <Presses {...props} size={size} />
  ) : (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <div className="grid min-w-0 flex-1 gap-0.5">
        <Line state={state} />
        {state.kind === "done" && state.told !== null ? (
          <p className="text-caption text-muted-foreground" data-ask-told>
            {state.told}
          </p>
        ) : null}
      </div>
      {props.action}
    </div>
  );
  return (
    <div
      className={
        density === "compact"
          ? "flex min-h-7 items-center text-body"
          : "flex min-h-8 items-center text-body"
      }
      data-ask-footer={state.kind}
    >
      <div
        className={moved ? "min-w-0 flex-1 motion-safe:animate-zerops-appear" : "min-w-0 flex-1"}
        key={face}
      >
        {body}
      </div>
    </div>
  );
}

function Presses(props: AskFooterProps & { readonly size: "sm" | "md" }) {
  const { state, main, size } = props;
  const working = state.kind === "working" ? state : null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {main === null || main === undefined ? null : (
        <Button
          disabled={working !== null || main.disabled === true}
          onClick={main.onPress}
          size={size}
          data-ask-main=""
          variant={props.destructive === true ? "destructive" : "primary"}
        >
          {working?.pressed === "main" ? <Spinner size="xs" /> : null}
          {working?.pressed === "main" ? working.words : main.label}
        </Button>
      )}
      {working === null ? props.also : null}
      {props.onNotNow === undefined ? null : (
        <Button
          data-ask-not-now=""
          disabled={working !== null}
          onClick={props.onNotNow}
          size={size}
          variant="ghost"
        >
          {working?.pressed === "notNow" ? <Spinner size="xs" /> : null}
          {NOT_NOW}
        </Button>
      )}
      {working === null && props.note !== undefined ? (
        <span className="text-caption text-muted-foreground">{props.note}</span>
      ) : null}
    </div>
  );
}

/** The one line of a settled, failed or someone else's ask, said once with its mark. */
function Line({ state }: { readonly state: AskState }) {
  switch (state.kind) {
    case "done":
      return (
        <Badge dot tone="success" wrap>
          {state.words}
        </Badge>
      );
    case "failed":
      return (
        <Badge dot role="alert" tone="danger" wrap>
          {state.words}
        </Badge>
      );
    case "notNow":
    case "replaced":
      return (
        <span className="text-muted-foreground">
          <Badge dot wrap>
            {state.words}
          </Badge>
        </span>
      );
    case "working":
      return (
        <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <Spinner size="xs" />
          {state.words}
        </span>
      );
    case "othersToAnswer":
      return <span className="text-caption text-muted-foreground">{state.words}</span>;
    default:
      return null;
  }
}

/** A change shown as facts: each label beside its value, a changed value as was → now. */
export function AskFacts({
  rows,
}: {
  readonly rows: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
    readonly was?: string;
  }>;
}) {
  return (
    <Card size="sm" variant="inset">
      <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-caption">
        {rows.map((row) => (
          <Fragment key={row.label}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 break-words">
              {row.was === undefined ? (
                row.value
              ) : (
                <>
                  <del className="text-muted-foreground">{row.was}</del> →{" "}
                  <ins className="font-medium no-underline">{row.value}</ins>
                </>
              )}
            </dd>
          </Fragment>
        ))}
      </dl>
    </Card>
  );
}

export interface AskStep {
  /** The step's name in its list: "add", "sign-in". */
  readonly id: string;
  readonly label: ReactNode;
  /** A quiet word beside it: an address, whose access it uses. */
  readonly detail?: ReactNode;
  readonly state: "done" | "now" | "next";
  /** What it came to, at its end: "Added", "Signed in as Aleš". */
  readonly end?: string | undefined;
}

/** A composite ask's numbered steps, in the order that is real: add, then sign in. */
export function AskSteps({ steps }: { readonly steps: ReadonlyArray<AskStep> }) {
  return (
    <Card variant="inset">
      <ol className="divide-y divide-foreground/6">
        {steps.map((step, index) => (
          <li
            className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2.5 text-body"
            data-ask-step={step.state}
            key={step.id}
          >
            <span
              className={cn(
                "grid size-5 place-items-center rounded-full font-medium text-caption",
                step.state === "done" && "bg-status-ok-surface text-status-ok-text",
                step.state === "now" && "bg-primary text-primary-foreground",
                step.state === "next" && "bg-muted text-muted-foreground",
              )}
            >
              {index + 1}
            </span>
            <span className="min-w-0">
              {step.label}
              {step.detail === undefined ? null : (
                <span className="ms-1.5 text-caption text-muted-foreground">{step.detail}</span>
              )}
            </span>
            {step.end === undefined ? (
              <span />
            ) : (
              <span className="text-caption text-muted-foreground">{step.end}</span>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}
