import type { ComponentProps } from "react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

type SpinnerSize = NonNullable<ComponentProps<typeof Spinner>["size"]>;
type SpinnerTone = NonNullable<ComponentProps<typeof Spinner>["tone"]>;

const SIZES = variantsOf<SpinnerSize>({ xs: true, sm: true, md: true, lg: true });
const TONES = variantsOf<SpinnerTone>({ current: true, muted: true });
// It has no size of its own: unset, it stands in a press, whose glyph rule sizes it.
const SIZE_OPTIONS = [...SIZES, "unset"] as const;

export default definePlayground({
  section: "spinner",
  name: "Spinner",
  imports: 'import { Spinner } from "~/components/ui/spinner";',
  controls: {
    size: { kind: "enum", options: SIZE_OPTIONS, note: "unset inside a Button, which sizes it" },
    tone: { kind: "enum", options: TONES, note: "muted beside muted words" },
  },
  initial: { size: "md", tone: "current" },
  render: ({ size, tone }) =>
    size === "unset" ? (
      <Button disabled variant="secondary">
        <Spinner tone={tone} />
        Deploying
      </Button>
    ) : (
      <Spinner size={size} tone={tone} />
    ),
  jsx: ({ size, tone }) => {
    const spinner = jsxElement(
      "Spinner",
      { size: size === "unset" ? undefined : size, tone },
      undefined,
      {
        tone: "current",
      },
    );
    return size === "unset"
      ? jsxElement("Button", { variant: "secondary", disabled: true }, `${spinner}\nDeploying`)
      : spinner;
  },
  usage: {
    do: [
      "Put it in the press that started the work, beside its words, while that work runs.",
      "Use it for a wait with no known end and no steps.",
    ],
    dont: [
      "Stand it where content will appear: that is Loading, shaped like the content.",
      "Show it beside a Failure, or spin forever after the source stopped answering.",
      "Use it for a long operation with steps: that is Progress.",
    ],
  },
});
