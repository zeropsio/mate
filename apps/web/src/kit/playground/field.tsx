import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";

import { definePlayground, jsxElement } from "../kitPlayground";

export default definePlayground({
  section: "field",
  name: "Field",
  imports:
    'import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";',
  controls: {
    label: { kind: "text", note: "what the control holds" },
    description: { kind: "text", note: "help that stays under it; empty for none" },
    invalid: { kind: "boolean", note: "marks the control and shows the error" },
    error: { kind: "text", note: "what to change, shown while invalid" },
    disabled: { kind: "boolean" },
  },
  initial: {
    label: "Name",
    description: "Lowercase letters and numbers.",
    invalid: false,
    error: "Use lowercase letters and numbers only.",
    disabled: false,
  },
  render: ({ label, description, invalid, error, disabled }) => (
    <div className="w-72">
      <Field disabled={disabled} invalid={invalid}>
        <FieldLabel>{label}</FieldLabel>
        <Input defaultValue={invalid ? "Store Front" : "storefront"} key={String(invalid)} />
        {description === "" ? null : <FieldDescription>{description}</FieldDescription>}
        <FieldError match>{error}</FieldError>
      </Field>
    </div>
  ),
  jsx: ({ label, description, invalid, error, disabled }) =>
    jsxElement(
      "Field",
      { invalid, disabled },
      [
        `<FieldLabel>${label}</FieldLabel>`,
        "<Input />",
        description === "" ? "" : `<FieldDescription>${description}</FieldDescription>`,
        `<FieldError match>${error}</FieldError>`,
      ]
        .filter((part) => part !== "")
        .join("\n"),
      { invalid: false, disabled: false },
    ),
  usage: {
    do: [
      "Wrap each form control in a Field: its label, help and error read as one.",
      "Say in the error what to change, not that something is wrong.",
      "Group related Fields in a Fieldset with a legend, inside a Form.",
      "Put a checkbox or a switch in a Label beside its words instead.",
    ],
    dont: [
      "Use a placeholder as the label: it leaves as the person types.",
      "Show the error before the person has answered.",
    ],
  },
});
