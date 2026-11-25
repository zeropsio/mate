import { GitBranchIcon } from "lucide-react";

import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "~/components/ui/combobox";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";

const BRANCHES = ["main", "fix/cache-main-20260918-180825", "feat/vault", "release/0.15"];
const SIZES = ["sm", "default", "lg"] as const;

export default definePlayground({
  section: "combobox",
  name: "Combobox",
  imports:
    'import { Combobox, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxPopup } from "~/components/ui/combobox";',
  controls: {
    size: { kind: "enum", options: SIZES },
    icon: { kind: "boolean", note: "a glyph for what it picks, at its start" },
    showTrigger: { kind: "boolean", note: "the chevron that lists every value" },
    showClear: { kind: "boolean", note: "a press that empties it, when none is allowed" },
    disabled: { kind: "boolean" },
  },
  initial: { size: "default", icon: false, showTrigger: true, showClear: false, disabled: false },
  render: ({ size, icon, showTrigger, showClear, disabled }) => (
    <div className="w-72">
      <Combobox defaultValue="main" disabled={disabled} items={BRANCHES}>
        <ComboboxInput
          aria-label="Branch"
          showClear={showClear}
          showTrigger={showTrigger}
          size={size}
          startAddon={icon ? <GitBranchIcon /> : undefined}
        />
        <ComboboxPopup>
          <ComboboxEmpty>No branch matches.</ComboboxEmpty>
          <ComboboxList>
            {(branch: string) => (
              <ComboboxItem key={branch} value={branch}>
                {branch}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    </div>
  ),
  jsx: ({ size, icon, showTrigger, showClear, disabled }) =>
    jsxElement(
      "Combobox",
      { items: jsxCode("branches"), defaultValue: "main", disabled },
      [
        jsxElement(
          "ComboboxInput",
          {
            "aria-label": "Branch",
            size,
            startAddon: icon ? jsxCode("<GitBranchIcon />") : undefined,
            showTrigger,
            showClear,
          },
          undefined,
          { size: "default", showTrigger: true, showClear: false },
        ),
        "<ComboboxPopup>",
        "  <ComboboxEmpty>No branch matches.</ComboboxEmpty>",
        "  <ComboboxList>",
        "    {(branch: string) => (",
        "      <ComboboxItem key={branch} value={branch}>",
        "        {branch}",
        "      </ComboboxItem>",
        "    )}",
        "  </ComboboxList>",
        "</ComboboxPopup>",
      ].join("\n"),
      { disabled: false },
    ),
  usage: {
    do: [
      "Use it to pick one value from a list too long to scan: a branch, a region, a service.",
      "Keep the trigger, so the whole list is one press away without typing.",
      "Type here to narrow it; the list opens under the field.",
    ],
    dont: [
      "Use it for a handful of values: a Select, or a RadioGroup when they all fit in view.",
      "Accept text that is not in the list: that is an Autocomplete.",
    ],
  },
});
