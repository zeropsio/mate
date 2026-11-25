import { Input } from "~/components/ui/input";

import { definePlayground, jsxElement } from "../kitPlayground";

const SIZES = ["sm", "compact", "default", "lg", "xl", "hero"] as const;

export default definePlayground({
  section: "input",
  name: "Input",
  imports: 'import { Input } from "~/components/ui/input";',
  controls: {
    size: { kind: "enum", options: SIZES, note: "hero for a page that is this one field" },
    font: { kind: "enum", options: ["default", "mono"], note: "mono for paths, commands, numbers" },
    type: { kind: "enum", options: ["text", "search", "password"], note: "password holds a key" },
    placeholder: { kind: "text" },
    disabled: { kind: "boolean" },
    invalid: { kind: "boolean", note: "aria-invalid" },
  },
  initial: {
    size: "default",
    font: "default",
    type: "text",
    placeholder: "storefront",
    disabled: false,
    invalid: false,
  },
  render: ({ size, font, type, placeholder, disabled, invalid }) => (
    <div className="w-80">
      <Input
        aria-invalid={invalid || undefined}
        aria-label="Name"
        disabled={disabled}
        font={font}
        placeholder={placeholder}
        size={size}
        type={type}
      />
    </div>
  ),
  jsx: ({ size, font, type, placeholder, disabled, invalid }) =>
    jsxElement(
      "Input",
      { size, font, type, placeholder, disabled, "aria-invalid": invalid },
      undefined,
      { size: "default", font: "default", type: "text", disabled: false, "aria-invalid": false },
    ),
  usage: {
    do: [
      "Label every field, visibly or with aria-label.",
      "Use mono for paths, commands, colours and numbers.",
    ],
    dont: [
      "Use password for an account's password: sign-in is Zerops'. It holds a key or a token.",
      "Shrink a field under 16 px type on a phone; iOS zooms the page.",
    ],
  },
});
