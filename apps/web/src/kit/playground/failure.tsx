import { BoxIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Failure } from "~/components/ui/failure";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";

// `mark` is a page's only, so size and mark are one choice here.
const FORMS = ["inline", "line", "page", "page with mark"] as const;
const sizeOf = (form: (typeof FORMS)[number]) =>
  form === "inline" || form === "line" ? form : "page";

const MARK_CODE = '<BoxIcon className="size-12 text-muted-foreground" />';

export default definePlayground({
  section: "failure",
  name: "Failure",
  imports: 'import { Failure } from "~/components/ui/failure";',
  controls: {
    form: {
      kind: "enum",
      options: FORMS,
      note: "line for an action's refusal where it stands (its cause only); page for a whole page that failed, marked with its subject",
    },
    cause: { kind: "text", note: "what went wrong, in the person's words" },
    children: { kind: "text", note: "one more line: what is kept, what happens next" },
    action: { kind: "boolean", note: "the one press that fixes it; none when nothing here can" },
    details: { kind: "text", note: "the source's own words, folded; empty for none" },
  },
  initial: {
    form: "inline",
    cause: "Couldn't read the project's people.",
    children: "",
    action: true,
    details: "HQ answered 502 Bad Gateway.",
  },
  render: ({ form, cause, children, action, details }) => {
    const size = sizeOf(form);
    const failure = (
      <Failure
        action={
          action ? (
            <Button size={size === "page" ? "md" : "sm"} variant="secondary">
              Try again
            </Button>
          ) : undefined
        }
        cause={cause}
        details={details === "" ? undefined : details}
        mark={
          form === "page with mark" ? (
            <BoxIcon className="size-12 text-muted-foreground" />
          ) : undefined
        }
        size={size}
      >
        {children === "" ? undefined : children}
      </Failure>
    );
    return size === "page" ? (
      // A page's frame, at a size the stage holds whole.
      <div className="relative flex h-96 w-160 min-w-0 flex-col overflow-hidden rounded-card border">
        {failure}
      </div>
    ) : (
      <div className="w-120">{failure}</div>
    );
  },
  jsx: ({ form, cause, children, action, details }) =>
    jsxElement(
      "Failure",
      {
        size: sizeOf(form),
        cause,
        // A line is its cause alone.
        action:
          action && form !== "line"
            ? jsxCode(
                form === "inline"
                  ? '<Button size="sm" variant="secondary">Try again</Button>'
                  : '<Button variant="secondary">Try again</Button>',
              )
            : undefined,
        details: details === "" || form === "line" ? undefined : details,
        mark: form === "page with mark" ? jsxCode(MARK_CODE) : undefined,
      },
      form === "line" ? "" : children,
      { size: "inline" },
    ),
  usage: {
    do: [
      "Stand it in the place that failed: the card, the list or the panel, at its size.",
      "Say the cause as the person sees it, then the one action that fixes it.",
      "Fold the source's own words under Details, for whoever reports it.",
      "Use size page when the whole page could not open, with its subject's mark.",
      "Use size line for an action's refusal where the action stands: under its form, beside its buttons.",
    ],
    dont: [
      "Put a spinner beside it or retry on a timer the person cannot see.",
      "Lead with a status code or an error name; that goes under Details.",
      "Offer an action that cannot fix it; leave it out instead.",
    ],
  },
});
