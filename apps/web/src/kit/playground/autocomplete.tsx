import { SearchIcon } from "lucide-react";

import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "~/components/ui/autocomplete";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";

const SERVICES = ["storefront", "backoffice", "db", "cache", "search"];
const SIZES = ["sm", "default", "lg"] as const;

export default definePlayground({
  section: "autocomplete",
  name: "Autocomplete",
  imports:
    'import { Autocomplete, AutocompleteEmpty, AutocompleteInput, AutocompleteItem, AutocompleteList, AutocompletePopup } from "~/components/ui/autocomplete";',
  controls: {
    size: { kind: "enum", options: SIZES },
    icon: { kind: "boolean", note: "a search glyph at its start" },
    showTrigger: { kind: "boolean", note: "a chevron that lists every suggestion" },
    showClear: { kind: "boolean", note: "a press that empties it" },
    placeholder: { kind: "text" },
    disabled: { kind: "boolean" },
  },
  initial: {
    size: "default",
    icon: false,
    showTrigger: false,
    showClear: false,
    placeholder: "Find a service",
    disabled: false,
  },
  render: ({ size, icon, showTrigger, showClear, placeholder, disabled }) => (
    <div className="w-64">
      <Autocomplete items={SERVICES}>
        <AutocompleteInput
          aria-label="Service"
          disabled={disabled}
          placeholder={placeholder}
          showClear={showClear}
          showTrigger={showTrigger}
          size={size}
          startAddon={icon ? <SearchIcon /> : undefined}
        />
        <AutocompletePopup>
          <AutocompleteEmpty>No service matches.</AutocompleteEmpty>
          <AutocompleteList>
            {(service: string) => (
              <AutocompleteItem key={service} value={service}>
                {service}
              </AutocompleteItem>
            )}
          </AutocompleteList>
        </AutocompletePopup>
      </Autocomplete>
    </div>
  ),
  jsx: ({ size, icon, showTrigger, showClear, placeholder, disabled }) =>
    jsxElement(
      "Autocomplete",
      { items: jsxCode("services") },
      [
        jsxElement(
          "AutocompleteInput",
          {
            "aria-label": "Service",
            placeholder,
            size,
            startAddon: icon ? jsxCode("<SearchIcon />") : undefined,
            showTrigger,
            showClear,
            disabled,
          },
          undefined,
          { size: "default", showTrigger: false, showClear: false, disabled: false },
        ),
        "<AutocompletePopup>",
        "  <AutocompleteEmpty>No service matches.</AutocompleteEmpty>",
        "  <AutocompleteList>",
        "    {(service: string) => (",
        "      <AutocompleteItem key={service} value={service}>",
        "        {service}",
        "      </AutocompleteItem>",
        "    )}",
        "  </AutocompleteList>",
        "</AutocompletePopup>",
      ].join("\n"),
    ),
  usage: {
    do: [
      "Use it for free text where suggestions help but any answer is allowed: a search, a name.",
      "Say in the empty line that nothing matches, in the words of what it lists.",
      "Type here to see the suggestions open under it.",
    ],
    dont: [
      "Use it when the answer must be one of the list: that is a Combobox, or a Select when short.",
      "Search actions and places from the keyboard with it: that is the Command palette.",
    ],
  },
});
