import { ArrowRightIcon, PlusIcon } from "lucide-react";

import {
  Button,
  type ButtonShape,
  type ButtonSize,
  type ButtonVariant,
} from "~/components/ui/button";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

const VARIANTS = variantsOf<ButtonVariant>({
  primary: true,
  secondary: true,
  ghost: true,
  "ghost-muted": true,
  destructive: true,
  "destructive-ghost": true,
  link: true,
  sidebar: true,
  bare: true,
  send: true,
  scrim: true,
  warning: true,
});

const SIZES = variantsOf<ButtonSize>({
  "2xs": true,
  xs: true,
  sm: true,
  md: true,
  lg: true,
  "icon-2xs": true,
  "icon-xs": true,
  "icon-sm": true,
  "icon-md": true,
});

const SHAPES = variantsOf<ButtonShape>({ rectangle: true, round: true });
const ICONS = ["none", "leading", "trailing"] as const;

export default definePlayground({
  section: "button",
  name: "Button",
  imports: 'import { Button } from "~/components/ui/button";',
  controls: {
    variant: { kind: "enum", options: VARIANTS, note: "primary for the one next step" },
    size: { kind: "enum", options: SIZES, note: "icon-* take a glyph and an aria-label" },
    shape: { kind: "enum", options: SHAPES, note: "round only for send and a pill" },
    icon: { kind: "enum", options: ICONS, note: "a lucide glyph beside the words" },
    children: { kind: "text", note: "what it opens or changes" },
    disabled: { kind: "boolean" },
  },
  initial: {
    variant: "primary",
    size: "md",
    shape: "rectangle",
    icon: "none",
    children: "Create project",
    disabled: false,
  },
  render: ({ variant, size, shape, icon, children, disabled }) => {
    const iconOnly = size.startsWith("icon");
    return (
      <Button
        aria-label={iconOnly ? children : undefined}
        disabled={disabled}
        shape={shape}
        size={size}
        variant={variant}
      >
        {iconOnly || icon === "leading" ? <PlusIcon /> : null}
        {iconOnly ? null : children}
        {!iconOnly && icon === "trailing" ? <ArrowRightIcon /> : null}
      </Button>
    );
  },
  jsx: ({ variant, size, shape, icon, children, disabled }) => {
    const iconOnly = size.startsWith("icon");
    const body = iconOnly
      ? "<PlusIcon />"
      : [
          icon === "leading" ? "<PlusIcon />" : "",
          children,
          icon === "trailing" ? "<ArrowRightIcon />" : "",
        ]
          .filter((part) => part !== "")
          .join("\n");
    return jsxElement(
      "Button",
      { variant, size, shape, disabled, "aria-label": iconOnly ? children : undefined },
      body,
      { variant: "primary", size: "md", shape: "rectangle", disabled: false },
    );
  },
  usage: {
    do: [
      "One primary press per surface: the next step. Everything beside it is secondary or ghost.",
      "Say what it opens or changes: Create project, not OK.",
      "Put a dialog's presses at its end edge, secondary before primary.",
      "Give an icon-only press an aria-label and a tooltip that say the same action.",
    ],
    dont: [
      "Restyle it with className; pick a variant and a size, or ask for a new variant.",
      "Use destructive for anything but deleting, stopping or acting on Production.",
      "Draw a label as a press: a label is a Badge.",
      "Round a press except the composer's send and a pill under a name.",
    ],
  },
});
