import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";

import { definePlayground, jsxElement } from "../kitPlayground";

export default definePlayground({
  section: "checkbox",
  name: "Checkbox",
  imports: 'import { Checkbox } from "~/components/ui/checkbox";',
  controls: {
    checked: { kind: "boolean" },
    indeterminate: { kind: "boolean", note: "some of a group" },
    disabled: { kind: "boolean" },
    label: { kind: "text" },
  },
  initial: { checked: true, indeterminate: false, disabled: false, label: "Deploy every service" },
  render: ({ checked, indeterminate, disabled, label }) => (
    <Label>
      <Checkbox checked={checked} disabled={disabled} indeterminate={indeterminate} />
      {label}
    </Label>
  ),
  jsx: ({ checked, indeterminate, disabled, label }) =>
    jsxElement(
      "Label",
      {},
      `${jsxElement("Checkbox", { checked, indeterminate, disabled }, undefined, { indeterminate: false, disabled: false })}\n${label}`,
    ),
  usage: {
    do: ["Use it for a choice a form saves, or one of several in a list."],
    dont: ["Use it for a setting that takes effect at once: that is a Switch."],
  },
});
