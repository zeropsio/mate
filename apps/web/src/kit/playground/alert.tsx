import type { ComponentProps } from "react";
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

type AlertVariant = NonNullable<ComponentProps<typeof Alert>["variant"]>;
type AlertSurface = NonNullable<ComponentProps<typeof Alert>["surface"]>;

const VARIANTS = variantsOf<AlertVariant>({
  default: true,
  info: true,
  success: true,
  warning: true,
  error: true,
});
const SURFACES = variantsOf<AlertSurface>({ default: true, glass: true, bare: true });
// `controlAlignment` only reads in a row, so the two props are one choice here.
const LAYOUTS = ["row", "first-line", "centered"] as const;

const ICON = {
  default: { Icon: InfoIcon, name: "InfoIcon" },
  info: { Icon: InfoIcon, name: "InfoIcon" },
  success: { Icon: CircleCheckIcon, name: "CircleCheckIcon" },
  warning: { Icon: TriangleAlertIcon, name: "TriangleAlertIcon" },
  error: { Icon: CircleAlertIcon, name: "CircleAlertIcon" },
} as const satisfies Record<AlertVariant, unknown>;

const layoutProps = (layout: (typeof LAYOUTS)[number]) =>
  ({
    layout: layout === "centered" ? "centered" : "row",
    controlAlignment: layout === "first-line" ? "first-line" : "center",
  }) as const;

export default definePlayground({
  section: "alert",
  name: "Alert",
  imports:
    'import { Alert, AlertAction, AlertDescription, AlertTitle } from "~/components/ui/alert";',
  controls: {
    variant: { kind: "enum", options: VARIANTS, note: "tints its edge and its icon" },
    surface: {
      kind: "enum",
      options: SURFACES,
      note: "glass over content, bare inside a parent's surface",
    },
    layout: {
      kind: "enum",
      options: LAYOUTS,
      note: "first-line holds the icon and action on the title's line",
    },
    icon: { kind: "boolean" },
    title: { kind: "text", note: "what happened" },
    description: { kind: "text", note: "what it means or what fixes it; empty for none" },
    action: { kind: "boolean", note: "the one press that acts on it" },
  },
  initial: {
    variant: "info",
    surface: "default",
    layout: "row",
    icon: true,
    title: "The deploy finished",
    description: "storefront runs the build from 18:02.",
    action: true,
  },
  render: ({ variant, surface, layout, icon, title, description, action }) => {
    const { Icon } = ICON[variant];
    return (
      <div className="w-96">
        <Alert {...layoutProps(layout)} surface={surface} variant={variant}>
          {icon ? <Icon /> : null}
          {title === "" ? null : <AlertTitle>{title}</AlertTitle>}
          {description === "" ? null : <AlertDescription>{description}</AlertDescription>}
          {action ? (
            <AlertAction>
              <Button size="sm" variant="secondary">
                Open
              </Button>
            </AlertAction>
          ) : null}
        </Alert>
      </div>
    );
  },
  jsx: ({ variant, surface, layout, icon, title, description, action }) =>
    jsxElement(
      "Alert",
      { variant, surface, ...layoutProps(layout) },
      [
        icon ? `<${ICON[variant].name} />` : "",
        title === "" ? "" : `<AlertTitle>${title}</AlertTitle>`,
        description === "" ? "" : `<AlertDescription>${description}</AlertDescription>`,
        action
          ? '<AlertAction>\n  <Button size="sm" variant="secondary">Open</Button>\n</AlertAction>'
          : "",
      ]
        .filter((part) => part !== "")
        .join("\n"),
      { variant: "default", surface: "default", layout: "row", controlAlignment: "center" },
    ),
  usage: {
    do: [
      "Stand it where the thing it is about lives, and leave it until the cause is gone.",
      "Title it with what happened; put what fixes it in the description and the action.",
      "Use error only for something that failed; a Failure says it with Details folded under.",
      "Set it bare inside a surface that already draws a card, such as the composer's drawer.",
    ],
    dont: [
      "Announce something that just happened and is over: that is a Toast.",
      "Ask a question that blocks the page: that is an AlertDialog.",
      "Give it more than one action, or a primary press beside the page's own.",
    ],
  },
});
