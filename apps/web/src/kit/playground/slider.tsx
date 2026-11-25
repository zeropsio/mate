import { Slider } from "~/components/ui/slider";

import { definePlayground } from "../kitPlayground";

const VALUES = ["0", "25", "50", "75", "100"] as const;

export default definePlayground({
  section: "slider",
  name: "Slider",
  imports: 'import { Slider } from "~/components/ui/slider";',
  controls: {
    defaultValue: { kind: "enum", options: VALUES, note: "where the thumb starts" },
    disabled: { kind: "boolean" },
    label: { kind: "text", note: "what the number is, for a screen reader" },
  },
  initial: { defaultValue: "50", disabled: false, label: "Glass opacity" },
  render: ({ defaultValue, disabled, label }) => (
    <Slider
      aria-label={label}
      className="w-52"
      defaultValue={Number(defaultValue)}
      disabled={disabled}
      key={defaultValue}
    />
  ),
  jsx: ({ defaultValue, disabled, label }) =>
    `<Slider aria-label=${JSON.stringify(label)} defaultValue={${defaultValue}}${disabled ? " disabled" : ""} />`,
  usage: {
    do: [
      "Use it where the person judges the effect by eye: contrast, opacity.",
      "Show the number beside it when the number matters.",
    ],
    dont: ["Use it for an exact value the person knows: that is a NumberField."],
  },
});
