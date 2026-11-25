import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";

import { definePlayground, jsxElement } from "../kitPlayground";

export default definePlayground({
  section: "switch",
  name: "Switch",
  imports: 'import { Switch } from "~/components/ui/switch";',
  controls: {
    checked: { kind: "boolean" },
    disabled: { kind: "boolean" },
    label: { kind: "text", note: "what turns on" },
  },
  initial: { checked: true, disabled: false, label: "Wake the preview on a visit" },
  render: ({ checked, disabled, label }) => (
    <Label>
      <Switch checked={checked} disabled={disabled} />
      {label}
    </Label>
  ),
  jsx: ({ checked, disabled, label }) =>
    jsxElement(
      "Label",
      {},
      `${jsxElement("Switch", { checked, disabled }, undefined, { disabled: false })}\n${label}`,
    ),
  usage: {
    do: ["Use it for a setting that takes effect at once.", "Name what turns on, beside it."],
    dont: ["Use it inside a form that saves later: that is a Checkbox."],
  },
});
