import { useState } from "react";

import { RadioSwatch, RadioSwatchGroup } from "~/components/ui/radio-group";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";

const TINTS = ["coral", "amber", "olive", "sky", "violet", "rose", "sand", "slate"] as const;
type Tint = (typeof TINTS)[number];

/** The row of a Mate's tints, picked as it goes. */
function Tints({ seats }: { readonly seats: boolean }) {
  const [tint, setTint] = useState<Tint>("sky");
  return (
    <RadioSwatchGroup
      aria-label="Colour"
      className="flex w-80 justify-between"
      onValueChange={setTint}
      options={TINTS}
      value={tint}
    >
      {TINTS.map((option) => (
        // A filling swatch takes the box of the seat its caller gives it.
        <div className={seats ? "size-7" : "contents"} key={option}>
          <RadioSwatch
            aria-label={option}
            size={seats ? "fill" : "default"}
            style={{ color: `var(--zerops-mate-tint-${option})` }}
            value={option}
          >
            <svg aria-hidden="true" viewBox="0 0 36 36">
              <circle
                cx="18"
                cy="18"
                data-slot="radio-swatch-ring"
                fill="none"
                r="15.5"
                stroke="currentColor"
                strokeWidth="2"
              />
              <circle cx="18" cy="18" fill="currentColor" r="12" />
            </svg>
          </RadioSwatch>
        </div>
      ))}
    </RadioSwatchGroup>
  );
}

export default definePlayground({
  section: "radio-group",
  name: "RadioSwatch",
  imports: 'import { RadioSwatch, RadioSwatchGroup } from "~/components/ui/radio-group";',
  controls: {
    size: {
      kind: "enum",
      options: ["default", "fill"],
      note: "fill takes a seat its caller places",
    },
  },
  initial: { size: "default" },
  render: ({ size }) => <Tints seats={size === "fill"} />,
  jsx: ({ size }) => {
    const swatch = jsxElement(
      "RadioSwatch",
      {
        key: size === "fill" ? undefined : jsxCode("tint"),
        "aria-label": jsxCode("tint"),
        value: jsxCode("tint"),
        size,
        style: jsxCode("{ color: `var(--zerops-mate-tint-${tint})` }"),
      },
      '<svg aria-hidden="true" viewBox="0 0 36 36">…</svg>',
      { size: "default" },
    );
    const seated =
      size === "fill"
        ? jsxElement("div", { key: jsxCode("tint"), className: "size-7" }, swatch)
        : swatch;
    return jsxElement(
      "RadioSwatchGroup",
      {
        "aria-label": "Colour",
        options: jsxCode("tints"),
        value: jsxCode("picked"),
        onValueChange: jsxCode("setPicked"),
      },
      `{tints.map((tint) => (\n${seated
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n")}\n))}`,
    );
  },
  usage: {
    do: [
      "Use it for a choice drawn as its own mark, a colour or a shape, with no words.",
      "Name every swatch with an aria-label: it carries no words of its own.",
      "Draw its ring with data-slot radio-swatch-ring, so the picked one shows without a size change.",
    ],
    dont: ["Use it for choices with names: those are Radio or a Select."],
  },
});
