import { CommandIcon } from "lucide-react";

import { Kbd, KbdGroup } from "~/components/ui/kbd";

import { definePlayground, jsxElement } from "../kitPlayground";

/** Where the keys stand: alone, in a sentence, at a menu item's end. */
const PLACES = ["alone", "sentence", "menu item"] as const;

/** The keys of a chord, as the person reads them: separated by spaces. */
function keysOf(keys: string): string[] {
  return keys.split(/\s+/u).filter((key) => key !== "");
}

export default definePlayground({
  section: "kbd",
  name: "Kbd",
  imports: 'import { Kbd, KbdGroup } from "~/components/ui/kbd";',
  controls: {
    keys: { kind: "text", note: "space between keys; two or more make a KbdGroup" },
    icon: { kind: "boolean", note: "the command key as its glyph, first" },
    place: { kind: "enum", options: PLACES },
  },
  initial: { keys: "⌘ K", icon: false, place: "alone" },
  render: ({ keys, icon, place }) => {
    const list = keysOf(keys);
    const keyElements = [
      ...(icon
        ? [
            <Kbd key="icon">
              <CommandIcon />
            </Kbd>,
          ]
        : []),
      ...list.map((key, index) => <Kbd key={`${String(index)}-${key}`}>{key}</Kbd>),
    ];
    const chord = keyElements.length > 1 ? <KbdGroup>{keyElements}</KbdGroup> : keyElements[0];
    if (place === "sentence") {
      return (
        <span className="text-body text-foreground">Press {chord} to open the command menu.</span>
      );
    }
    if (place === "menu item") {
      return (
        <span className="flex w-64 items-center justify-between gap-4 text-body text-foreground">
          Open the command menu
          {chord}
        </span>
      );
    }
    return chord ?? null;
  },
  jsx: ({ keys, icon }) => {
    const kbds = [
      ...(icon ? ["<Kbd>\n  <CommandIcon />\n</Kbd>"] : []),
      ...keysOf(keys).map((key) => jsxElement("Kbd", {}, key)),
    ];
    return kbds.length > 1 ? jsxElement("KbdGroup", {}, kbds.join("\n")) : (kbds[0] ?? "");
  },
  usage: {
    do: [
      "Show the chord that does what the line beside it says, as the person's keyboard writes it.",
      "Group a chord's keys in a KbdGroup: ⌘ and K, side by side.",
      "Set it at a menu item's end edge, muted under the item's words.",
    ],
    dont: [
      "Make it a press: a key is pressed on the keyboard.",
      "Spell a key out in words where its glyph is what the keyboard shows.",
    ],
  },
});
