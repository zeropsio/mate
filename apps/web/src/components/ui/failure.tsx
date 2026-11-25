import { CircleAlertIcon } from "lucide-react";
import type * as React from "react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "./alert";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./collapsible";
import { StatusPage } from "./status-page";

/**
 * The source's own words for a failure, folded under "Details": never the first thing read, always
 * there for whoever reports it, to select and copy. `fields` says them as labelled lines instead
 * ("Where", "Rule", "Evidence"): each value in the source's own monospace, its label muted beside it.
 */
function FailureDetails({
  children,
  fields,
  align = "start",
}: {
  readonly children?: React.ReactNode;
  readonly fields?: ReadonlyArray<{ readonly label: string; readonly value: React.ReactNode }>;
  /** Where "Details" stands: under a sentence at a line's end, `end`. The words read from the start. */
  readonly align?: "start" | "end";
}) {
  return (
    <Collapsible data-slot="failure-details">
      <div className={align === "end" ? "flex justify-end" : "flex"}>
        <CollapsibleTrigger className="text-muted-foreground text-caption underline-offset-4 hover:underline">
          Details
        </CollapsibleTrigger>
      </div>
      <CollapsiblePanel>
        {fields === undefined ? (
          <p className="m-0 mt-1.5 whitespace-pre-wrap break-words text-left font-mono text-muted-foreground text-caption">
            {children}
          </p>
        ) : (
          <dl className="m-0 mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-left text-caption">
            {fields.map((field) => (
              <div className="contents" key={field.label}>
                <dt className="text-muted-foreground">{field.label}</dt>
                <dd className="m-0 font-mono text-foreground/80 wrap-anywhere">{field.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </CollapsiblePanel>
    </Collapsible>
  );
}

/**
 * Something failed: the cause in the person's words, the one action that fixes it, and the
 * source's own words folded under Details. Never a spinner beside it. `inline` stands in the place
 * that failed (a card, a list, a panel); `page` is a whole page that failed, in a fixed frame;
 * `line` is an action's refusal said where the action stands (under a form, beside its buttons, in
 * a card's foot): the cause alone, one red line of body text that wraps, no box and no mark.
 */
function Failure({
  cause,
  children,
  action,
  details,
  mark,
  size = "inline",
  ...props
}: Omit<React.HTMLAttributes<HTMLElement>, "children"> & {
  /** What went wrong, in the person's words: the headline. */
  readonly cause: React.ReactNode;
  /** One more line, when the cause needs it: what is kept, what happens next. */
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
    return (
      <span
        className="block text-pretty text-body text-status-failed-text"
        data-size="line"
        data-slot="failure"
        {...props}
      >
        {cause}
      </span>
    );
  }
  const folded =
    details === undefined || details === null || details === "" ? null : (
      <FailureDetails>{details}</FailureDetails>
    );
  if (size === "page") {
    return (
      <StatusPage
        actions={action}
        data-slot="failure"
        footer={folded}
        mark={mark}
        title={<span role="alert">{cause}</span>}
        {...props}
      >
        {children}
      </StatusPage>
    );
  }
  return (
    <Alert controlAlignment="first-line" data-slot="failure" variant="error" {...props}>
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle>{cause}</AlertTitle>
      {children === undefined && folded === null ? null : (
        <AlertDescription>
          {children}
          {folded}
        </AlertDescription>
      )}
      {action === undefined || action === null ? null : <AlertAction>{action}</AlertAction>}
    </Alert>
  );
}

export { Failure, FailureDetails };
