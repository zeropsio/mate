import { ChevronDownIcon, CircleAlertIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "~/lib/utils";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "./alert";
import { InlineButton } from "./button";
import { CodeBlock } from "./code-block";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./collapsible";
import { StatusPage } from "./status-page";

/**
 * The source's words as it sent them, on the code ground, scrolled past about nine lines, with one
 * Copy: what `FailureDetails` draws for words given as a string, for a panel that holds more.
 */
function FailureWords({ words }: { readonly words: string }) {
  return (
    <CodeBlock copy="the details" height="sm">
      {words}
    </CodeBlock>
  );
}

const DETAILS_ALIGN = {
  start: "text-start",
  center: "text-center",
  end: "text-end",
} as const;

type DetailsFields = ReadonlyArray<{ readonly label: string; readonly value: React.ReactNode }>;

/** The press that unfolds Details: muted words in the size of the text around it, a chevron. */
function DetailsTrigger({ label }: { readonly label: string }) {
  return (
    <CollapsibleTrigger render={<InlineButton tone="muted" />}>
      {label}
      <ChevronDownIcon
        aria-hidden="true"
        className="size-3.5 transition-transform duration-200 ease-out-strong in-data-panel-open:rotate-180"
      />
    </CollapsibleTrigger>
  );
}

/** What Details unfolds, read from the start whatever stands around it. */
function DetailsPanel({
  children,
  fields,
}: {
  readonly children?: React.ReactNode;
  readonly fields?: DetailsFields | undefined;
}) {
  return (
    <CollapsiblePanel>
      <div className="pt-2 text-left">
        {fields !== undefined ? (
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-caption">
            {fields.map((field) => (
              <div className="contents" key={field.label}>
                <dt className="text-muted-foreground">{field.label}</dt>
                <dd className="m-0 font-mono text-foreground/80 wrap-anywhere">{field.value}</dd>
              </div>
            ))}
          </dl>
        ) : typeof children === "string" ? (
          <FailureWords words={children} />
        ) : (
          children
        )}
      </div>
    </CollapsiblePanel>
  );
}

/**
 * The source's own words for a failure, or a slow stage's diagnostics, folded under one muted
 * "Details" with its chevron: never the first thing read, always there for whoever reports it.
 * Words given as a string sit in a well, in the source's monospace, to select or copy whole;
 * other children (a log being read, a list of services) stand in the panel as they are. `fields`
 * says them as labelled lines instead ("Where", "Rule", "Evidence"): each value in monospace, its
 * label muted beside it. `align` places the press on its line (a stage's centred column, a line's
 * end); what it opens always reads from the start.
 */
function FailureDetails({
  children,
  fields,
  label = "Details",
  align = "start",
}: {
  readonly children?: React.ReactNode;
  readonly fields?: DetailsFields;
  /** The press's words, when they name what it folds: "Project services (3)". */
  readonly label?: string;
  readonly align?: keyof typeof DETAILS_ALIGN;
}) {
  return (
    <Collapsible className="w-full min-w-0" data-slot="failure-details">
      <div className={DETAILS_ALIGN[align]}>
        <DetailsTrigger label={label} />
      </div>
      <DetailsPanel fields={fields}>{children}</DetailsPanel>
    </Collapsible>
  );
}

const given = (node: React.ReactNode) => node !== undefined && node !== null && node !== "";

/**
 * Something failed, said as one form in every place: what failed (the cause, in the person's
 * words), why or what is kept (one more line, when the cause needs it), the one action that fixes
 * it, and the source's own words folded under Details. Never a spinner beside it, never a status
 * code or a raw answer as its headline.
 *
 * - `inline` — stands in the place that failed (a card, a list, a panel): an error notice.
 * - `page` — a whole page that failed, in a fixed frame, marked with its subject.
 * - `line` — an action's refusal said where the action stands (under a form, beside its buttons,
 *   in a card's foot, in a person's row): the cause as one red line of body text that wraps, no
 *   box and no mark, in the one ink of what is wrong (`status-failed-text`, as `Text`'s `error`); its why in muted words under it; then its action and Details on one line,
 *   flowing with the text's own alignment.
 */
function Failure({
  cause,
  children,
  action,
  details,
  mark,
  size = "inline",
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLElement>, "children"> & {
  /** What went wrong, in the person's words: the headline. */
  readonly cause: React.ReactNode;
  /** One more line, when the cause needs it: why, what is kept, what happens next. */
  readonly children?: React.ReactNode;
  /** The one action that fixes the cause; none when nothing here can. */
  readonly action?: React.ReactNode;
  /** The source's own words, folded. */
  readonly details?: React.ReactNode;
  /** A page's mark: the subject's face or icon. */
  readonly mark?: React.ReactNode;
  readonly size?: "inline" | "page" | "line";
}) {
  if (size === "line") {
    const foot = given(action) || given(details);
    if (!given(children) && !foot) {
      return (
        <span
          className={cn("block text-pretty text-body text-status-failed-text", className)}
          data-size="line"
          data-slot="failure"
          {...props}
        >
          {cause}
        </span>
      );
    }
    return (
      <span
        className={cn("flex min-w-0 flex-col gap-1 text-body", className)}
        data-size="line"
        data-slot="failure"
        {...props}
      >
        <span className="text-pretty text-status-failed-text">{cause}</span>
        {given(children) ? (
          <span className="text-pretty text-muted-foreground">{children}</span>
        ) : null}
        {foot ? (
          // Its action and Details' press share one line in inline flow, so they follow the
          // alignment of the words above; what Details unfolds spans the line under them.
          <Collapsible className="block" data-slot="failure-details" render={<span />}>
            <span className="block space-x-3">
              {action}
              {given(details) ? <DetailsTrigger label="Details" /> : null}
            </span>
            {given(details) ? <DetailsPanel>{details}</DetailsPanel> : null}
          </Collapsible>
        ) : null}
      </span>
    );
  }
  const folded = given(details) ? <FailureDetails>{details}</FailureDetails> : null;
  if (size === "page") {
    return (
      <StatusPage
        actions={action}
        className={className}
        data-slot="failure"
        footer={folded === null ? null : <FailureDetails align="center">{details}</FailureDetails>}
        mark={mark}
        title={<span role="alert">{cause}</span>}
        {...props}
      >
        {children}
      </StatusPage>
    );
  }
  return (
    <Alert
      className={className}
      controlAlignment="first-line"
      data-slot="failure"
      icon={<CircleAlertIcon aria-hidden="true" />}
      variant="error"
      {...props}
    >
      <AlertTitle>{cause}</AlertTitle>
      {children === undefined && folded === null ? null : (
        <AlertDescription>
          {children}
          {folded}
        </AlertDescription>
      )}
      {given(action) ? <AlertAction>{action}</AlertAction> : null}
    </Alert>
  );
}

export { Failure, FailureDetails, FailureWords };
