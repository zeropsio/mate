import { BoldIcon } from "lucide-react";

import { Toggle } from "~/components/ui/toggle";

import { definePlayground, jsxElement } from "../kitPlayground";

export default definePlayground({
  section: "toggle",
  name: "Toggle",
  imports: 'import { Toggle } from "~/components/ui/toggle";',
  controls: {
    variant: { kind: "enum", options: ["default", "ghost", "outline", "segmented"] },
    size: { kind: "enum", options: ["xs", "sm", "compact", "default", "lg"] },
    pressed: { kind: "boolean" },
    disabled: { kind: "boolean" },
  },
  initial: { variant: "outline", size: "default", pressed: true, disabled: false },
  render: ({ variant, size, pressed, disabled }) => (
    <Toggle aria-label="Bold" disabled={disabled} pressed={pressed} size={size} variant={variant}>
      <BoldIcon />
    </Toggle>
  ),
  jsx: ({ variant, size, pressed, disabled }) =>
    jsxElement(
      "Toggle",
      { "aria-label": "Bold", variant, size, pressed, disabled },
      "<BoldIcon />",
      { variant: "default", size: "default", disabled: false },
    ),
  usage: {
    do: ["Use it for one setting that is on or off, shown by being pressed."],
    dont: ["Use it for an action that happens once: that is a Button."],
  },
});
