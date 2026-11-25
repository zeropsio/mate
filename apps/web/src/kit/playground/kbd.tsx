import { CommandIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Kbd, KbdGroup } from "~/components/ui/kbd";

import { definePlayground, jsxElement } from "../kitPlayground";

/** Where the keys stand: alone, in a sentence, at a menu item's end, on a press. */
const PLACES = ["alone", "sentence", "menu item", "press"] as const;
const TONES = ["muted", "ink"] as const;

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
    tone: { kind: "enum", options: TONES, note: "ink: inside a press, in its own ink" },
  },
  initial: { keys: "⌘ K", icon: false, place: "alone", tone: "muted" },
  render: ({ keys, icon, place, tone }) => {
    const list = keysOf(keys);
    const keyElements = [
      ...(icon
        ? [
            <Kbd key="icon" tone={tone}>
              <CommandIcon />
            </Kbd>,
          ]
        : []),
      ...list.map((key, index) => (
        <Kbd key={`${String(index)}-${key}`} tone={tone}>
          {key}
        </Kbd>
      )),
    ];
    const chord = keyElements.length > 1 ? <KbdGroup>{keyElements}</KbdGroup> : keyElements[0];
    if (place === "sentence") {
      return (
        <span className="text-body text-foreground">Press {chord} to open the command menu.</span>
      );
    }
    if (place === "press") {
      return <Button>Merge {chord}</Button>;
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
  jsx: ({ keys, icon, tone }) => {
    const open = tone === "ink" ? '<Kbd tone="ink">' : "<Kbd>";
    const kbds = [
      ...(icon ? [`${open}\n  <CommandIcon />\n</Kbd>`] : []),
      ...keysOf(keys).map((key) => jsxElement("Kbd", { tone }, key, { tone: "muted" })),
    ];
    return kbds.length > 1 ? jsxElement("KbdGroup", {}, kbds.join("\n")) : (kbds[0] ?? "");
  },
  usage: {
    do: [
      "Show the chord that does what the line beside it says, as the person's keyboard writes it.",
      "Group a chord's keys in a KbdGroup: ⌘ and K, side by side.",
      "Set it at a menu item's end edge, muted under the item's words.",
      "Inside a press, take the press's ink: tone ink.",
    ],
    dont: [
      "Make it a press: a key is pressed on the keyboard.",
      "Spell a key out in words where its glyph is what the keyboard shows.",
    ],
  },
});
