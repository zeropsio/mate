import type { ComponentProps } from "react";
import { CopyIcon, SearchIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Spinner } from "~/components/ui/spinner";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

type InputGroupVariant = NonNullable<ComponentProps<typeof InputGroup>["variant"]>;
type AddonAlign = NonNullable<ComponentProps<typeof InputGroupAddon>["align"]>;

const VARIANTS = variantsOf<InputGroupVariant>({ default: true, ghost: true });
const ALIGNS = variantsOf<AddonAlign>({
  "inline-start": true,
  "inline-end": true,
  "block-start": true,
  "block-end": true,
});
const ADDONS = ["icon", "spinner", "button", "word"] as const;

const ADDON = {
  icon: { node: <SearchIcon />, code: "<SearchIcon />" },
  spinner: { node: <Spinner />, code: "<Spinner />" },
  button: {
    node: (
      <Button aria-label="Copy the address" size="icon-xs" variant="ghost">
        <CopyIcon />
      </Button>
    ),
    code: '<Button aria-label="Copy the address" size="icon-xs" variant="ghost">\n  <CopyIcon />\n</Button>',
  },
  word: { node: <span>https://</span>, code: "<span>https://</span>" },
} as const satisfies Record<(typeof ADDONS)[number], unknown>;

export default definePlayground({
  section: "input-group",
  name: "InputGroup",
  imports:
    'import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";',
  controls: {
    variant: { kind: "enum", options: VARIANTS, note: "ghost draws no frame until focused" },
    align: { kind: "enum", options: ALIGNS, note: "block-* stand above or below the words" },
    addon: {
      kind: "enum",
      options: ADDONS,
      note: "a glyph, work under way, a press, a fixed word",
    },
    disabled: { kind: "boolean" },
    invalid: { kind: "boolean", note: "aria-invalid on its input" },
  },
  initial: {
    variant: "default",
    align: "inline-end",
    addon: "button",
    disabled: false,
    invalid: false,
  },
  render: ({ variant, align, addon, disabled, invalid }) => (
    <div className="w-80">
      <InputGroup variant={variant}>
        <InputGroupInput
          aria-invalid={invalid || undefined}
          aria-label="Address"
          defaultValue="storefront-1a2b.prg1.zerops.app"
          disabled={disabled}
        />
        <InputGroupAddon align={align}>{ADDON[addon].node}</InputGroupAddon>
      </InputGroup>
    </div>
  ),
  jsx: ({ variant, align, addon, disabled, invalid }) =>
    jsxElement(
      "InputGroup",
      { variant },
      [
        jsxElement(
          "InputGroupInput",
          { "aria-label": "Address", disabled, "aria-invalid": invalid },
          undefined,
          { disabled: false, "aria-invalid": false },
        ),
        jsxElement("InputGroupAddon", { align }, ADDON[addon].code, { align: "inline-start" }),
      ].join("\n"),
      { variant: "default" },
    ),
  usage: {
    do: [
      "Put what acts on the words inside their frame: a copy press, a clear press, a search glyph.",
      "Show work on the value with a Spinner in the addon, where the person is looking.",
      "Use ghost in a toolbar or a menu's search, where a frame would add a box.",
    ],
    dont: [
      "Put the field's label in an addon: that is a FieldLabel above it.",
      "Stack more than one press in an addon; a second action belongs beside the field.",
    ],
  },
});
