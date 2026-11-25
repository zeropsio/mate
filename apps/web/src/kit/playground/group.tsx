import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "~/components/ui/button";
import { Group, GroupSeparator } from "~/components/ui/group";
import { Input } from "~/components/ui/input";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

const ORIENTATIONS = variantsOf<NonNullable<ComponentProps<typeof Group>["orientation"]>>({
  horizontal: true,
  vertical: true,
});
/** What the group joins: a press with its menu, a field with its press, three presses. */
const PIECES = ["split press", "field and press", "three presses"] as const;

export default definePlayground({
  section: "group",
  name: "Group",
  imports: 'import { Group, GroupSeparator } from "~/components/ui/group";',
  controls: {
    pieces: { kind: "enum", options: PIECES, note: "controls that act together" },
    orientation: { kind: "enum", options: ORIENTATIONS },
    separator: { kind: "boolean", note: "a hairline between the pieces" },
  },
  initial: { pieces: "split press", orientation: "horizontal", separator: true },
  render: ({ pieces, orientation, separator }) => {
    const line = separator ? (
      <GroupSeparator orientation={orientation === "vertical" ? "horizontal" : "vertical"} />
    ) : null;
    return (
      <Group orientation={orientation}>
        {pieces === "split press" ? (
          <>
            <Button variant="secondary">Deploy</Button>
            {line}
            <Button aria-label="More deploy choices" size="icon-md" variant="secondary">
              <ChevronDownIcon />
            </Button>
          </>
        ) : pieces === "field and press" ? (
          <>
            <Input aria-label="Domain" placeholder="shop.example.com" />
            {line}
            <Button variant="secondary">Add</Button>
          </>
        ) : (
          <>
            <Button variant="secondary">Stage</Button>
            {line}
            <Button variant="secondary">Production</Button>
            {line}
            <Button variant="secondary">Preview</Button>
          </>
        )}
      </Group>
    );
  },
  jsx: ({ pieces, orientation, separator }) => {
    const line = separator
      ? jsxElement("GroupSeparator", {
          orientation: orientation === "vertical" ? "horizontal" : undefined,
        })
      : undefined;
    const children =
      pieces === "split press"
        ? [
            '<Button variant="secondary">Deploy</Button>',
            line,
            '<Button aria-label="More deploy choices" size="icon-md" variant="secondary">\n  <ChevronDownIcon />\n</Button>',
          ]
        : pieces === "field and press"
          ? [
              '<Input aria-label="Domain" placeholder="shop.example.com" />',
              line,
              '<Button variant="secondary">Add</Button>',
            ]
          : [
              '<Button variant="secondary">Stage</Button>',
              line,
              '<Button variant="secondary">Production</Button>',
              line,
              '<Button variant="secondary">Preview</Button>',
            ];
    return jsxElement(
      "Group",
      { orientation },
      children.filter((child) => child !== undefined).join("\n"),
      { orientation: "horizontal" },
    );
  },
  usage: {
    do: [
      "Join controls that act on one thing into one shape: a press and its menu, a field and its press.",
      "Put a GroupSeparator between pieces of the same weight; turn it horizontal in a vertical group.",
    ],
    dont: [
      "Group presses that do unrelated things: give each its own place.",
      "Use it for a choice of one among several: that is a ToggleGroup.",
    ],
  },
});
