import { PaletteIcon } from "lucide-react";

import { ClaudeAI, OpenAI, OpenCodeIcon } from "~/components/Icons";
import { LogoTile } from "~/components/ui/logo-tile";

import { definePlayground, jsxElement } from "../kitPlayground";

const MARKS = {
  Claude: <ClaudeAI />,
  Codex: <OpenAI />,
  OpenCode: <OpenCodeIcon />,
  Acme: "A",
  Express: <PaletteIcon />,
} as const;
const NAMES = ["Claude", "Codex", "OpenCode", "Acme", "Express"] as const;
const MARK_SOURCE = {
  Claude: "<ClaudeAI />",
  Codex: "<OpenAI />",
  OpenCode: "<OpenCodeIcon />",
  Acme: "A",
  Express: "<PaletteIcon />",
} as const;

export default definePlayground({
  section: "logo-tile",
  name: "LogoTile",
  imports: 'import { LogoTile } from "~/components/ui/logo-tile";',
  controls: {
    size: {
      kind: "enum",
      options: ["md", "lg", "sm"],
      note: "lg an lg row's or a picker's start, md an md row's or a card's, sm a compact line",
    },
    ground: { kind: "enum", options: ["card", "menu"], note: "menu: flat, in the menu's tint" },
    mark: { kind: "enum", options: NAMES, note: "a logo, an organization's letter, an icon" },
    name: { kind: "boolean", note: "the thing's name beside it" },
  },
  initial: { size: "md", ground: "card", mark: "Claude", name: true },
  render: ({ size, ground, mark, name }) => (
    <span className="flex items-center gap-3 text-body font-medium text-foreground">
      <LogoTile ground={ground} size={size}>
        {MARKS[mark]}
      </LogoTile>
      {name ? mark : null}
    </span>
  ),
  jsx: ({ size, ground, mark }) =>
    jsxElement("LogoTile", { size, ground }, MARK_SOURCE[mark], { size: "md", ground: "card" }),
  usage: {
    do: [
      "Lead a thing's name with what it is: an agent's logo, an organization's letter, a tool's letters, a kind of thing's icon.",
      "Let the tile size the mark: leave a logo or an icon without a size of its own.",
      "Pick the size of the row it leads: md in an md row, lg in an lg row.",
    ],
    dont: [
      "Put a person's or a Mate's face on it: that is PersonAvatar or MateFace.",
      "Draw a tile by hand with a ground and a corner: every mark tile is this one.",
    ],
  },
});
