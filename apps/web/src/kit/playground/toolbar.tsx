import { CropIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { Toolbar } from "~/components/ui/toolbar";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

const SIZES = variantsOf<NonNullable<ComponentProps<typeof Toolbar>["size"]>>({
  sm: true,
  md: true,
});

export default definePlayground({
  section: "toolbar",
  name: "Toolbar",
  imports: 'import { Toolbar } from "~/components/ui/toolbar";',
  controls: {
    size: { kind: "enum", options: SIZES, note: "sm: on its surface; md: floating over a stage" },
  },
  initial: { size: "sm" },
  render: ({ size }) =>
    size === "sm" ? (
      <Toolbar aria-label="Terminal" size={size}>
        <Button aria-label="New terminal" size="icon-2xs" variant="ghost">
          <PlusIcon />
        </Button>
        <Separator className="h-4" orientation="vertical" />
        <Button aria-label="Close terminal" size="icon-2xs" variant="ghost">
          <Trash2Icon />
        </Button>
      </Toolbar>
    ) : (
      <Toolbar aria-label="Picture" size={size}>
        <Button variant="ghost">
          <CropIcon />
          Crop
        </Button>
        <Separator className="mx-1 h-5" orientation="vertical" />
        <Button variant="ghost">
          <PencilIcon />
          Draw
        </Button>
      </Toolbar>
    ),
  jsx: ({ size }) =>
    jsxElement(
      "Toolbar",
      { "aria-label": "Terminal", size },
      '<Button aria-label="New terminal" size="icon-2xs" variant="ghost">…</Button>',
      { size: "sm" },
    ),
  usage: {
    do: [
      "Stand a few presses over what they act on: a terminal, a table, a picture.",
      "Part groups of presses with a vertical Separator.",
    ],
    dont: [
      "Head a pane with it: a pane's bar is PanelBar.",
      "Float one press over scrolling content: that is FloatingAction.",
    ],
  },
});
