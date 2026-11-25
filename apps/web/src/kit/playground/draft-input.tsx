import { useState } from "react";

import { DraftInput } from "~/components/ui/draft-input";
import type { InputProps } from "~/components/ui/input";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

type InputSize = Exclude<NonNullable<InputProps["size"]>, number>;

const SIZES = variantsOf<InputSize>({
  sm: true,
  compact: true,
  default: true,
  lg: true,
  xl: true,
  hero: true,
  inline: true,
});

/** The field beside the value it last committed, so a commit shows where it lands. */
function Committing({
  size,
  font,
  disabled,
}: {
  readonly size: InputSize;
  readonly font: "default" | "mono";
  readonly disabled: boolean;
}) {
  const [committed, setCommitted] = useState("storefront");
  return (
    <div className="flex w-72 flex-col gap-2">
      <DraftInput
        aria-label="Service name"
        disabled={disabled}
        font={font}
        onCommit={setCommitted}
        size={size}
        value={committed}
      />
      <span className="text-caption text-muted-foreground">Saved: {committed}</span>
    </div>
  );
}

export default definePlayground({
  section: "draft-input",
  name: "DraftInput",
  imports: 'import { DraftInput } from "~/components/ui/draft-input";',
  controls: {
    size: { kind: "enum", options: SIZES, note: "Input's sizes" },
    font: { kind: "enum", options: ["default", "mono"], note: "mono for paths and numbers" },
    disabled: { kind: "boolean" },
  },
  initial: { size: "default", font: "default", disabled: false },
  render: (args) => <Committing {...args} />,
  jsx: ({ size, font, disabled }) =>
    jsxElement(
      "DraftInput",
      {
        "aria-label": "Service name",
        value: jsxCode("name"),
        onCommit: jsxCode("setName"),
        size,
        font,
        disabled,
      },
      undefined,
      { size: "default", font: "default", disabled: false },
    ),
  usage: {
    do: [
      "Use it for a setting saved as it is typed, backed by the server: it commits on Enter or blur.",
      "Type here, then press Enter or leave the field to see the saved value change.",
    ],
    dont: [
      "Use it inside a form with its own save press: that is an Input.",
      "Save on every key with a plain Input where each save is a round trip.",
    ],
  },
});
