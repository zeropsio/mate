import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

import { definePlayground, jsxElement } from "../kitPlayground";

const REGIONS = [
  { label: "Prague", value: "prg1" },
  { label: "Frankfurt", value: "fra1" },
  { label: "Singapore", value: "sgp1" },
];

export default definePlayground({
  section: "select",
  name: "Select",
  imports:
    'import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";',
  controls: {
    variant: {
      kind: "enum",
      options: ["default", "ghost", "button"],
      note: "button: a choice offered as a press",
    },
    size: { kind: "enum", options: ["xs", "sm", "default", "lg", "compact"] },
    disabled: { kind: "boolean" },
  },
  initial: { variant: "default", size: "default", disabled: false },
  render: ({ variant, size, disabled }) => (
    <div className="w-60">
      <Select defaultValue="prg1" disabled={disabled} items={REGIONS}>
        <SelectTrigger aria-label="Region" size={size} variant={variant}>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {REGIONS.map((region) => (
            <SelectItem key={region.value} value={region.value}>
              {region.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  ),
  jsx: ({ variant, size, disabled }) =>
    jsxElement(
      "Select",
      { defaultValue: "prg1", disabled, "items={REGIONS}": true },
      [
        jsxElement("SelectTrigger", { "aria-label": "Region", variant, size }, "<SelectValue />", {
          variant: "default",
          size: "default",
        }),
        "<SelectPopup>",
        "  {REGIONS.map((region) => (",
        "    <SelectItem key={region.value} value={region.value}>{region.label}</SelectItem>",
        "  ))}",
        "</SelectPopup>",
      ].join("\n"),
      { disabled: false },
    ),
  usage: {
    do: [
      "Use it for one choice among many; give the trigger an aria-label when no label stands beside it.",
    ],
    dont: ["Use it for two or three short choices side by side: that is a ToggleGroup."],
  },
});
