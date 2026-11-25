import type { ComponentProps } from "react";

import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "~/components/ui/number-field";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

type NumberFieldSize = NonNullable<ComponentProps<typeof NumberField>["size"]>;

const SIZES = variantsOf<NumberFieldSize>({ sm: true, default: true, lg: true });

export default definePlayground({
  section: "number-field",
  name: "NumberField",
  imports:
    'import { NumberField, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput } from "~/components/ui/number-field";',
  controls: {
    size: { kind: "enum", options: SIZES },
    steppers: { kind: "boolean", note: "the minus and plus presses beside the number" },
    disabled: { kind: "boolean" },
  },
  initial: { size: "default", steppers: true, disabled: false },
  render: ({ size, steppers, disabled }) => (
    <div className="w-40">
      <NumberField defaultValue={30} disabled={disabled} max={600} min={5} size={size} step={5}>
        <NumberFieldGroup>
          {steppers ? <NumberFieldDecrement aria-label="Wait 5 seconds less" /> : null}
          <NumberFieldInput aria-label="Seconds to wait before a restart" />
          {steppers ? <NumberFieldIncrement aria-label="Wait 5 seconds more" /> : null}
        </NumberFieldGroup>
      </NumberField>
    </div>
  ),
  jsx: ({ size, steppers, disabled }) =>
    jsxElement(
      "NumberField",
      { defaultValue: 30, min: 5, max: 600, step: 5, size, disabled },
      jsxElement(
        "NumberFieldGroup",
        {},
        [
          steppers ? '<NumberFieldDecrement aria-label="Wait 5 seconds less" />' : "",
          '<NumberFieldInput aria-label="Seconds to wait before a restart" />',
          steppers ? '<NumberFieldIncrement aria-label="Wait 5 seconds more" />' : "",
        ]
          .filter((part) => part !== "")
          .join("\n"),
      ),
      { size: "default", disabled: false },
    ),
  usage: {
    do: [
      "Use it for a count or a duration with bounds: seconds to wait, replicas, a limit.",
      "Set min, max and step to what the setting accepts, so it cannot be typed out of range.",
      "Say the unit in its label or beside it, and name each stepper by what it does.",
    ],
    dont: [
      "Use it for an id or a version: those are numbers to read, typed in an Input.",
      "Ask for a choice among a few values with it: that is a Select or a ToggleGroup.",
    ],
  },
});
