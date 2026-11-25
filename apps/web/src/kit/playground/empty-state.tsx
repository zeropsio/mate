import { BoxIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";

const SIZES = ["row", "section", "page"] as const;
// A row's mark is its own icon at the row's size; a section's and a page's grow with the room.
const MARK = {
  row: { mark: <BoxIcon />, code: "<BoxIcon />" },
  section: {
    mark: <BoxIcon className="size-8 text-muted-foreground" />,
    code: '<BoxIcon className="size-8 text-muted-foreground" />',
  },
  page: {
    mark: <BoxIcon className="size-10 text-muted-foreground" />,
    code: '<BoxIcon className="size-10 text-muted-foreground" />',
  },
} as const;

export default definePlayground({
  section: "empty",
  name: "EmptyState",
  imports: 'import { EmptyState } from "~/components/ui/empty";',
  controls: {
    size: { kind: "enum", options: SIZES, note: "where a list's rows would be, a panel, a page" },
    mark: { kind: "boolean", note: "the place's own icon or the subject's face" },
    action: { kind: "boolean", note: "the one way to fill it; none when there is nothing to do" },
    children: { kind: "text", note: "what will be here, true for this viewer" },
  },
  initial: {
    size: "section",
    mark: true,
    action: true,
    children: "No services yet. Add one and its Mate deploys it here.",
  },
  render: ({ size, mark, action, children }) => (
    // The room each size stands in: a list, a panel, a page at a size the stage holds whole.
    <div
      className={
        size === "page"
          ? "relative flex h-96 w-160 min-w-0 flex-col overflow-hidden rounded-card border"
          : size === "section"
            ? "relative flex min-h-40 w-110 min-w-0 flex-col overflow-hidden rounded-card border"
            : "relative flex min-h-12 w-110 min-w-0 flex-col overflow-hidden rounded-card border"
      }
    >
      <EmptyState
        action={
          action ? (
            <Button size="sm" variant="secondary">
              Add a service
            </Button>
          ) : undefined
        }
        mark={mark ? MARK[size].mark : undefined}
        size={size}
      >
        {children}
      </EmptyState>
    </div>
  ),
  jsx: ({ size, mark, action, children }) =>
    jsxElement(
      "EmptyState",
      {
        size,
        mark: mark ? jsxCode(MARK[size].code) : undefined,
        action: action
          ? jsxCode('<Button size="sm" variant="secondary">Add a service</Button>')
          : undefined,
      },
      children,
      { size: "section" },
    ),
  usage: {
    do: [
      "Show it only once the source answered that there is nothing; before that it is Loading.",
      "Say what will be here in one line, true for the person reading it.",
      "Offer at most one action, and none when the viewer can do nothing about it.",
    ],
    dont: [
      "Show it after a refusal or an error: that is a Failure.",
      "Build a bespoke one from Empty's parts when one of its three sizes fits.",
      "Explain how the system works; say what the person sees here next.",
    ],
  },
});
