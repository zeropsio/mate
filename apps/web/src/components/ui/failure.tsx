import { CircleAlertIcon } from "lucide-react";
import type * as React from "react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "./alert";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./collapsible";
import { StatusPage } from "./status-page";

/**
 * The source's own words for a failure, folded under "Details": never the first thing read, always
 * there for whoever reports it.
 */
function FailureDetails({ children }: { readonly children: React.ReactNode }) {
  return (
    <Collapsible data-slot="failure-details">
      <CollapsibleTrigger className="text-muted-foreground text-xs underline-offset-4 hover:underline">
        Details
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <p className="m-0 mt-1.5 whitespace-pre-wrap break-words text-left font-mono text-muted-foreground text-xs">
          {children}
        </p>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/**
 * Something failed: the cause in the person's words, the one action that fixes it, and the
 * source's own words folded under Details. Never a spinner beside it. `inline` stands in the place
 * that failed (a card, a list, a panel); `page` is a whole page that failed, in a fixed frame.
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
  readonly size?: "inline" | "page";
}) {
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
